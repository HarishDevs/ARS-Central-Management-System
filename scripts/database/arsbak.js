// D-408 (v1.81.0, BK-1): the ARS backup package (.arsbak). One file holds the
// whole system: a manifest, the database (schema + data, table by table), every
// uploaded file and the server's secrets. Shared by the app (Super Admin →
// Backup, restore & migrate), restore.js and restore-on-start.js.
//
// Layout (all integers big-endian):
//   "ARSPK1" | u32 header length | header JSON (not secret: KDF settings only)
//   frames…, each: u8 flags (1 = last) | u32 plaintext length | ciphertext | 16-byte GCM tag
// Key: scrypt(passphrase, salt; N=2^17, r=8, p=1 by default) → HKDF → an
// AES-256-GCM key and a 16-byte check value (so a wrong passphrase is told
// apart from a damaged file). A "server-key" package (scheduled backups and
// safety snapshots made without a person) uses BACKUP_ENCRYPTION_KEY instead.
// Each frame's nonce is the header's 8-byte prefix + the frame number, and its
// additional data binds the header hash, the frame number and the flags, so
// frames can't be swapped, dropped, reordered or cut off (the last frame is
// marked). Frames are independent, so the file is written and read in pieces
// (resumable across requests) and never needs to fit in memory.
// The decrypted stream is a list of entries:
//   u32 meta length | meta JSON {n: name, size, …} | data (size bytes) | sha256(data)
// so every part carries its own checksum, checked as it is read.
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");

const MAGIC = Buffer.from("ARSPK1");
const FORMAT_VERSION = 1;
const KDF_DEFAULT = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
const KDF_LIMITS = Object.freeze({ maxN: 2 ** 20, maxR: 16, maxP: 4 });
const FRAME_TARGET = 1 << 20; // 1 MiB of plaintext per frame
const MAX_FRAME = 64 << 20;
const MAX_ENTRY = 64 << 20;
const MAX_HEADER = 4096;
const MIN_PASSPHRASE = 12;

class PackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PackageError";
    this.code = code;
  }
}

const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const sha256 = (data) => crypto.createHash("sha256").update(data).digest();

function scryptAsync(passphrase, salt, kdf) {
  // maxmem must cover 128 * N * r bytes (128 MiB at the default cost).
  const maxmem = 128 * kdf.N * kdf.r + 32 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    crypto.scrypt(Buffer.from(String(passphrase).normalize("NFC"), "utf8"), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function subKeys(master, salt) {
  const key = Buffer.from(crypto.hkdfSync("sha256", master, salt, "ARS package encryption v1", 32));
  const check = Buffer.from(crypto.hkdfSync("sha256", master, salt, "ARS package check v1", 16));
  return { key, check };
}

// secret = { passphrase } or { serverKey: Buffer(32) }.
function serverKeyId(serverKey) {
  return sha256(Buffer.concat([Buffer.from("ARS server key id"), serverKey])).toString("hex").slice(0, 16);
}

async function masterFor(header, secret) {
  const salt = Buffer.from(header.kdf.salt, "base64");
  if (header.kdf.alg === "scrypt") {
    if (!secret || typeof secret.passphrase !== "string" || !secret.passphrase) throw new PackageError("PASSPHRASE_NEEDED", "Type the passphrase the package was made with.");
    const { N, r, p } = header.kdf;
    if (!Number.isInteger(N) || N < 2 ** 14 || N > KDF_LIMITS.maxN || (N & (N - 1)) !== 0 || !Number.isInteger(r) || r < 1 || r > KDF_LIMITS.maxR || !Number.isInteger(p) || p < 1 || p > KDF_LIMITS.maxP) {
      throw new PackageError("NOT_PACKAGE", "The package's key settings are out of range, so it isn't an ARS package or it was changed.");
    }
    return scryptAsync(secret.passphrase, salt, { N, r, p });
  }
  if (header.kdf.alg === "server-key") {
    const serverKey = secret && Buffer.isBuffer(secret.serverKey) ? secret.serverKey : secret && typeof secret.passphrase === "string" ? keyFromText(secret.passphrase) : null;
    if (!serverKey) throw new PackageError("SERVER_KEY_NEEDED", "This package was made by the server with BACKUP_ENCRYPTION_KEY. Restore it on a server with the same key, or type that key (the base64 text) as the passphrase.");
    return Buffer.from(crypto.hkdfSync("sha256", serverKey, salt, "ARS package server key v1", 32));
  }
  throw new PackageError("NOT_PACKAGE", "Unknown key type in the package header.");
}

// A typed BACKUP_ENCRYPTION_KEY (base64 of 32 bytes), else null.
function keyFromText(text) {
  const trimmed = String(text).trim();
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed, "base64");
  return key.length === 32 ? key : null;
}

function passphraseProblem(passphrase) {
  const text = String(passphrase ?? "");
  if (text.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters (a short sentence is easy to remember and hard to guess).`;
  if (text.length > 1024) return "Use at most 1,024 characters.";
  if (/^(.)\1+$/.test(text)) return "Don't repeat one character.";
  return null;
}

async function newHeader(secret, kdf = KDF_DEFAULT) {
  const salt = crypto.randomBytes(16);
  let header;
  let master;
  if (secret && Buffer.isBuffer(secret.serverKey)) {
    header = { v: FORMAT_VERSION, kdf: { alg: "server-key", id: serverKeyId(secret.serverKey), salt: salt.toString("base64") } };
  } else {
    const problem = passphraseProblem(secret && secret.passphrase);
    if (problem) throw new PackageError("WEAK_PASSPHRASE", problem);
    header = { v: FORMAT_VERSION, kdf: { alg: "scrypt", N: kdf.N, r: kdf.r, p: kdf.p, salt: salt.toString("base64") } };
  }
  master = await masterFor(header, secret);
  const { key, check } = subKeys(master, salt);
  header.nonce = crypto.randomBytes(8).toString("base64");
  header.check = check.toString("base64");
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const bytes = Buffer.concat([MAGIC, u32(json.length), json]);
  return { header, bytes, key };
}

function parseHeader(buffer) {
  if (buffer.length < MAGIC.length + 4 || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new PackageError("NOT_PACKAGE", "This isn't an ARS backup package (.arsbak).");
  const length = buffer.readUInt32BE(MAGIC.length);
  if (length < 2 || length > MAX_HEADER || buffer.length < MAGIC.length + 4 + length) throw new PackageError("DAMAGED", "The package header is damaged.");
  let header;
  try {
    header = JSON.parse(buffer.subarray(MAGIC.length + 4, MAGIC.length + 4 + length).toString("utf8"));
  } catch {
    throw new PackageError("DAMAGED", "The package header is damaged.");
  }
  if (!header || header.v !== FORMAT_VERSION || !header.kdf || typeof header.kdf.salt !== "string" || typeof header.nonce !== "string" || typeof header.check !== "string") {
    throw new PackageError("NOT_PACKAGE", "This package was made by a newer or unknown version of ARS CMS.");
  }
  return { header, bytes: buffer.subarray(0, MAGIC.length + 4 + length) };
}

async function unlock(header, secret) {
  const master = await masterFor(header, secret);
  const { key, check } = subKeys(master, Buffer.from(header.kdf.salt, "base64"));
  const expected = Buffer.from(header.check, "base64");
  if (expected.length !== check.length || !crypto.timingSafeEqual(expected, check)) {
    throw new PackageError(header.kdf.alg === "server-key" ? "WRONG_SERVER_KEY" : "WRONG_PASSPHRASE", header.kdf.alg === "server-key" ? "This package was made with a different BACKUP_ENCRYPTION_KEY." : "Wrong passphrase.");
  }
  return key;
}

function frameNonce(header, index) {
  return Buffer.concat([Buffer.from(header.nonce, "base64"), u32(index)]);
}
function frameAad(headerHash, index, flags) {
  return Buffer.concat([headerHash, u32(index), Buffer.from([flags])]);
}

function sealFrame(ctx, index, plaintext, last) {
  const flags = last ? 1 : 0;
  const cipher = crypto.createCipheriv("aes-256-gcm", ctx.key, frameNonce(ctx.header, index));
  cipher.setAAD(frameAad(ctx.headerHash, index, flags));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([flags]), u32(plaintext.length), body, cipher.getAuthTag()]);
}

function openFrame(ctx, index, flags, ciphertext, tag) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", ctx.key, frameNonce(ctx.header, index));
  decipher.setAAD(frameAad(ctx.headerHash, index, flags));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new PackageError("DAMAGED", `Part ${index + 1} of the package is damaged or was changed (its check failed).`);
  }
}

function encodeEntry(name, data, extra = {}) {
  if (typeof name !== "string" || !name || name.length > 1000) throw new Error("Entry name is required.");
  const body = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
  if (body.length > MAX_ENTRY) throw new Error(`Entry ${name} is over ${MAX_ENTRY} bytes; split it.`);
  const meta = Buffer.from(JSON.stringify({ ...extra, n: name, size: body.length }), "utf8");
  return { bytes: Buffer.concat([u32(meta.length), meta, body, sha256(body)]), hash: sha256(body).toString("hex"), size: body.length };
}

// Writes a package in pieces. Every checkpoint() closes the current frame, so
// a later request can resume() from the returned state on the same file.
class PackageWriter {
  constructor(file, handle, ctx, state) {
    this.file = file;
    this.handle = handle;
    this.ctx = ctx;
    this.frameIndex = state.frameIndex;
    this.size = state.size;
    this.pending = [];
    this.pendingBytes = 0;
    this.finished = false;
  }

  static async create(file, secret, options = {}) {
    const { header, bytes, key } = await newHeader(secret, options.kdf);
    const handle = await fsp.open(file, "w", 0o600);
    await handle.write(bytes);
    return new PackageWriter(file, handle, { header, key, headerHash: sha256(bytes) }, { frameIndex: 0, size: bytes.length });
  }

  // key: the Buffer from a previous writer (writer.key), kept in memory only.
  static async resume(file, key, state) {
    const handle = await fsp.open(file, "r+");
    const head = Buffer.alloc(MAGIC.length + 4 + MAX_HEADER);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const { header, bytes } = parseHeader(head.subarray(0, bytesRead));
    await handle.truncate(state.size); // drops a frame a crash left half-written
    return new PackageWriter(file, handle, { header, key, headerHash: sha256(bytes) }, state);
  }

  get key() {
    return this.ctx.key;
  }
  get kdf() {
    return this.ctx.header.kdf.alg;
  }

  async add(name, data, extra) {
    if (this.finished) throw new Error("The package is already finished.");
    const entry = encodeEntry(name, data, extra);
    this.pending.push(entry.bytes);
    this.pendingBytes += entry.bytes.length;
    if (this.pendingBytes >= FRAME_TARGET) await this.flush(false);
    return { hash: entry.hash, size: entry.size };
  }

  async flush(last) {
    if (!this.pendingBytes && !last) return;
    const plaintext = Buffer.concat(this.pending);
    this.pending = [];
    this.pendingBytes = 0;
    for (let offset = 0; offset < plaintext.length || (last && offset === 0); offset += MAX_FRAME) {
      const piece = plaintext.subarray(offset, offset + MAX_FRAME);
      const isLast = last && offset + MAX_FRAME >= plaintext.length;
      const frame = sealFrame(this.ctx, this.frameIndex, piece, isLast);
      await this.handle.write(frame, 0, frame.length, this.size);
      this.size += frame.length;
      this.frameIndex += 1;
      if (isLast) break;
    }
  }

  async checkpoint() {
    await this.flush(false);
    await this.handle.sync().catch(() => undefined);
    return { frameIndex: this.frameIndex, size: this.size };
  }

  async finish(manifest) {
    await this.add("manifest.json", manifest);
    await this.flush(true);
    this.finished = true;
    await this.handle.sync().catch(() => undefined);
    await this.close();
    return { frameIndex: this.frameIndex, size: this.size };
  }

  async close() {
    if (this.handle) await this.handle.close().catch(() => undefined);
    this.handle = null;
  }
}

// Reads a package entry by entry. Each entry comes with the position just
// after it, which entries({ from }) accepts to carry on in a later request.
class PackageReader {
  constructor(file, handle, ctx, start, kdfAlg) {
    this.file = file;
    this.handle = handle;
    this.ctx = ctx;
    this.start = start;
    this.kdf = kdfAlg;
  }

  static async readHeader(file) {
    const handle = await fsp.open(file, "r");
    try {
      const head = Buffer.alloc(MAGIC.length + 4 + MAX_HEADER);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      return parseHeader(head.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  // secret = { passphrase } | { serverKey } | { key } (a key already derived for this file).
  static async open(file, secret) {
    const handle = await fsp.open(file, "r");
    try {
      const head = Buffer.alloc(MAGIC.length + 4 + MAX_HEADER);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      const { header, bytes } = parseHeader(head.subarray(0, bytesRead));
      const key = secret && Buffer.isBuffer(secret.key) ? secret.key : await unlock(header, secret);
      return new PackageReader(file, handle, { header, key, headerHash: sha256(bytes) }, { frameOffset: bytes.length, frameIndex: 0, skip: 0 }, header.kdf.alg);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  get key() {
    return this.ctx.key;
  }

  async readFrame(offset, index) {
    const head = Buffer.alloc(5);
    const { bytesRead } = await this.handle.read(head, 0, 5, offset);
    if (bytesRead === 0) throw new PackageError("TRUNCATED", "The package is cut short (its last part is missing). Copy or download it again.");
    if (bytesRead < 5) throw new PackageError("TRUNCATED", "The package is cut short. Copy or download it again.");
    const flags = head[0];
    const length = head.readUInt32BE(1);
    if (flags > 1 || length > MAX_FRAME) throw new PackageError("DAMAGED", `Part ${index + 1} of the package is damaged.`);
    const body = Buffer.alloc(length + 16);
    const read = await this.handle.read(body, 0, body.length, offset + 5);
    if (read.bytesRead < body.length) throw new PackageError("TRUNCATED", "The package is cut short. Copy or download it again.");
    const plaintext = openFrame(this.ctx, index, flags, body.subarray(0, length), body.subarray(length));
    return { plaintext, last: flags === 1, next: offset + 5 + length + 16 };
  }

  // Yields { name, meta, data, position } for each entry from `from` (or the start).
  async *entries(from = null) {
    let position = from ? { ...from } : { ...this.start };
    // frames whose plaintext is in `buffer`: [{offset, index, start, length}]
    let frames = [];
    let buffer = Buffer.alloc(0);
    let consumed = 0; // bytes of `buffer` already used (absolute within loaded frames)
    let base = 0; // absolute plaintext position of buffer[0]
    let nextOffset = position.frameOffset;
    let nextIndex = position.frameIndex;
    let ended = false;

    const load = async () => {
      if (ended) return false;
      const frame = await this.readFrame(nextOffset, nextIndex);
      frames.push({ offset: nextOffset, index: nextIndex, start: base + buffer.length, length: frame.plaintext.length });
      buffer = buffer.length ? Buffer.concat([buffer, frame.plaintext]) : frame.plaintext;
      nextOffset = frame.next;
      nextIndex += 1;
      if (frame.last) {
        ended = true;
        const after = await this.handle.read(Buffer.alloc(1), 0, 1, nextOffset);
        if (after.bytesRead) throw new PackageError("DAMAGED", "The package has extra data after its last part.");
      }
      return true;
    };
    const need = async (bytes) => {
      while (buffer.length - (consumed - base) < bytes) {
        if (!(await load())) return false;
      }
      return true;
    };
    const take = (bytes) => {
      const at = consumed - base;
      const out = buffer.subarray(at, at + bytes);
      consumed += bytes;
      return out;
    };
    const positionAt = (absolute) => {
      // the frame containing `absolute`, or the next frame if it ends exactly there
      for (const frame of frames) {
        if (absolute >= frame.start && absolute < frame.start + frame.length) return { frameOffset: frame.offset, frameIndex: frame.index, skip: absolute - frame.start };
      }
      return { frameOffset: nextOffset, frameIndex: nextIndex, skip: 0 };
    };
    const compact = () => {
      // keep only the frames from the one holding `consumed`
      const keep = frames.findIndex((frame) => consumed < frame.start + frame.length);
      if (keep === -1) {
        frames = [];
        buffer = Buffer.alloc(0);
        base = consumed;
        return;
      }
      if (keep > 0) {
        const dropTo = frames[keep].start;
        buffer = buffer.subarray(dropTo - base);
        base = dropTo;
        frames = frames.slice(keep);
      }
    };

    // Skip into the first frame.
    if (position.skip) {
      if (!(await need(position.skip))) throw new PackageError("DAMAGED", "The saved place in the package is past its end.");
      take(position.skip);
    }
    for (;;) {
      if (buffer.length - (consumed - base) === 0) {
        if (ended) return;
        if (!(await load())) return;
        if (buffer.length - (consumed - base) === 0 && ended) return;
        continue;
      }
      if (!(await need(4))) throw new PackageError("TRUNCATED", "The package ends in the middle of a part.");
      const metaLength = take(4).readUInt32BE(0);
      if (metaLength < 2 || metaLength > 64 * 1024) throw new PackageError("DAMAGED", "A part of the package is damaged (bad entry header).");
      if (!(await need(metaLength))) throw new PackageError("TRUNCATED", "The package ends in the middle of a part.");
      let meta;
      try {
        meta = JSON.parse(take(metaLength).toString("utf8"));
      } catch {
        throw new PackageError("DAMAGED", "A part of the package is damaged (bad entry header).");
      }
      if (!meta || typeof meta.n !== "string" || !Number.isInteger(meta.size) || meta.size < 0 || meta.size > MAX_ENTRY) throw new PackageError("DAMAGED", "A part of the package is damaged (bad entry header).");
      if (!(await need(meta.size + 32))) throw new PackageError("TRUNCATED", `The package ends in the middle of ${meta.n}.`);
      const data = Buffer.from(take(meta.size));
      const hash = take(32);
      if (!sha256(data).equals(hash)) throw new PackageError("DAMAGED", `${meta.n} in the package doesn't match its checksum.`);
      const after = positionAt(consumed);
      compact();
      yield { name: meta.n, meta, data, hash: hash.toString("hex"), position: after };
    }
  }

  async close() {
    if (this.handle) await this.handle.close().catch(() => undefined);
    this.handle = null;
  }
}

// The sha256 of a whole file, streamed (for the .sha256 next to a package).
async function fileSha256(file) {
  const handle = await fsp.open(file, "r");
  try {
    const hash = crypto.createHash("sha256");
    const chunk = Buffer.alloc(4 << 20);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (!bytesRead) break;
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

// Reads the first entry (head.json) only: checks the passphrase and shows
// what the package is, without reading the rest.
async function readHead(file, secret) {
  const reader = await PackageReader.open(file, secret);
  try {
    for await (const entry of reader.entries()) {
      if (entry.name !== "head.json") throw new PackageError("DAMAGED", "The package doesn't start with its summary.");
      return { head: JSON.parse(entry.data.toString("utf8")), key: reader.key, kdf: reader.kdf };
    }
    throw new PackageError("DAMAGED", "The package is empty.");
  } finally {
    await reader.close();
  }
}

module.exports = {
  MAGIC,
  FORMAT_VERSION,
  KDF_DEFAULT,
  FRAME_TARGET,
  MAX_ENTRY,
  MIN_PASSPHRASE,
  PackageError,
  PackageWriter,
  PackageReader,
  passphraseProblem,
  keyFromText,
  serverKeyId,
  fileSha256,
  readHead,
  parseHeader,
};
