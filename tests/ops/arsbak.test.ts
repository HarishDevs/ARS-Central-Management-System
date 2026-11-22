import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as arsbak from "@/scripts/database/arsbak";

// D-408 (v1.81.0, BK-1): the .arsbak format. Round trip, wrong passphrase,
// tamper detection (flipped byte, swapped/dropped/cut frames), chunk boundaries,
// resuming a write and a read from a saved place.
const { PackageWriter, PackageReader, PackageError, readHead, passphraseProblem, keyFromText, fileSha256 } = arsbak;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arsbak-unit-"));
const FAST = { kdf: { N: 2 ** 14, r: 8, p: 1 } };
const PASS = { passphrase: "correct horse battery staple" };
let counter = 0;
const file = () => path.join(dir, `p${(counter += 1)}.arsbak`);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function readAll(target: string, secret: arsbak.PackageSecret) {
  const reader = await PackageReader.open(target, secret);
  const out: arsbak.PackageEntry[] = [];
  try {
    for await (const entry of reader.entries()) out.push(entry);
  } finally {
    await reader.close();
  }
  return out;
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PackageError);
  expect((error as InstanceType<typeof PackageError>).code).toBe(code);
}

describe("the .arsbak package", () => {
  it("round-trips entries of every size, across frame boundaries, with per-part checksums", async () => {
    const target = file();
    const writer = await PackageWriter.create(target, PASS, FAST);
    const parts: [string, Buffer][] = [
      ["head.json", Buffer.from(JSON.stringify({ app: "1.81.0" }))],
      ["empty", Buffer.alloc(0)],
      ["one", Buffer.from([0])],
      ["exactly-a-frame", crypto.randomBytes(arsbak.FRAME_TARGET)],
      ["over-two-frames", crypto.randomBytes(arsbak.FRAME_TARGET * 2 + 17)],
      ["unicode ✓ Śrī", Buffer.from("O'Brien \\ ✅ \n", "utf8")],
    ];
    for (const [name, data] of parts) await writer.add(name, data, { kind: "test" });
    await writer.finish({ done: true });
    const entries = await readAll(target, PASS);
    expect(entries.map((entry) => entry.name)).toEqual([...parts.map(([name]) => name), "manifest.json"]);
    for (const [index, [, data]] of parts.entries()) {
      expect(entries[index]!.data.equals(data)).toBe(true);
      expect(entries[index]!.hash).toBe(crypto.createHash("sha256").update(data).digest("hex"));
      expect(entries[index]!.meta.kind).toBe("test");
    }
    expect(JSON.parse(entries.at(-1)!.data.toString())).toEqual({ done: true });
    expect((await readHead(target, PASS)).head).toEqual({ app: "1.81.0" });
    expect(await fileSha256(target)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the high default scrypt cost and refuses a wrong passphrase", async () => {
    const target = file();
    const writer = await PackageWriter.create(target, PASS);
    await writer.add("head.json", "{}");
    await writer.finish({});
    const { header } = await PackageReader.readHeader(target);
    expect(header.kdf).toMatchObject({ alg: "scrypt", N: 2 ** 17, r: 8, p: 1 });
    await expectCode(PackageReader.open(target, { passphrase: "correct horse battery stapl" }), "WRONG_PASSPHRASE");
    await expectCode(PackageReader.open(target, { passphrase: "" }), "PASSPHRASE_NEEDED");
  });

  it("refuses weak passphrases when making a package", async () => {
    expect(passphraseProblem("short")).toMatch(/at least 12/);
    expect(passphraseProblem("aaaaaaaaaaaaaaaa")).toMatch(/repeat/);
    expect(passphraseProblem("a perfectly fine phrase")).toBeNull();
    await expectCode(PackageWriter.create(file(), { passphrase: "short" }), "WEAK_PASSPHRASE");
  });

  it("never stores the passphrase or the plain data", async () => {
    const target = file();
    const writer = await PackageWriter.create(target, PASS, FAST);
    await writer.add("secrets.json", JSON.stringify({ ENCRYPTION_KEY: "SUPER-SECRET-VALUE-123" }));
    await writer.finish({});
    const raw = fs.readFileSync(target);
    expect(raw.includes(Buffer.from("SUPER-SECRET-VALUE-123"))).toBe(false);
    expect(raw.includes(Buffer.from(PASS.passphrase))).toBe(false);
    expect(raw.includes(Buffer.from("secrets.json"))).toBe(false);
  });

  it("detects a flipped byte anywhere in the data", async () => {
    const target = file();
    const writer = await PackageWriter.create(target, PASS, FAST);
    await writer.add("data", crypto.randomBytes(3 * arsbak.FRAME_TARGET));
    await writer.finish({});
    const raw = fs.readFileSync(target);
    const headerLength = 6 + 4 + raw.readUInt32BE(6);
    for (const at of [raw.length - 1, raw.length - 40, Math.floor(raw.length / 2), headerLength, headerLength + 2, headerLength + 9]) {
      const copy = Buffer.from(raw);
      copy[at] = copy[at]! ^ 0x01;
      const bad = file();
      fs.writeFileSync(bad, copy);
      const error = await readAll(bad, PASS).then(() => null, (caught: unknown) => caught as { code?: string });
      expect(error?.code === "DAMAGED" || error?.code === "TRUNCATED").toBe(true);
    }
    // A changed header (the salt) reads as a wrong passphrase, never as data.
    const header = Buffer.from(raw);
    const salt = header.indexOf(Buffer.from('"salt":"')) + 8;
    header[salt] = header[salt] === 0x41 ? 0x42 : 0x41;
    const badHeader = file();
    fs.writeFileSync(badHeader, header);
    await expectCode(PackageReader.open(badHeader, PASS), "WRONG_PASSPHRASE");
  });

  it("detects a cut-off file, a dropped frame, swapped frames and extra data", async () => {
    const target = file();
    const writer = await PackageWriter.create(target, PASS, FAST);
    for (let index = 0; index < 3; index += 1) {
      await writer.add(`part-${index}`, crypto.randomBytes(1000));
      await writer.checkpoint(); // one frame per part
    }
    await writer.finish({});
    const raw = fs.readFileSync(target);
    const headerLength = 6 + 4 + raw.readUInt32BE(6);
    const frames: Buffer[] = [];
    for (let offset = headerLength; offset < raw.length; ) {
      const length = 5 + raw.readUInt32BE(offset + 1) + 16;
      frames.push(raw.subarray(offset, offset + length));
      offset += length;
    }
    expect(frames.length).toBe(4);
    const head = raw.subarray(0, headerLength);
    const write = (buffers: Buffer[]) => {
      const bad = file();
      fs.writeFileSync(bad, Buffer.concat(buffers));
      return bad;
    };
    await expectCode(readAll(write([head, ...frames.slice(0, 3)]), PASS), "TRUNCATED"); // last frame missing
    await expectCode(readAll(write([head, frames[0]!, frames[2]!, frames[3]!]), PASS), "DAMAGED"); // one dropped
    await expectCode(readAll(write([head, frames[1]!, frames[0]!, frames[2]!, frames[3]!]), PASS), "DAMAGED"); // swapped
    await expectCode(readAll(write([head, ...frames, Buffer.from("x")]), PASS), "DAMAGED"); // trailing data
    await expectCode(readAll(write([head, ...frames.slice(0, 3), frames[3]!.subarray(0, 30)]), PASS), "TRUNCATED");
    // The "last" flag can't be set on an earlier frame.
    const flagged = Buffer.from(frames[2]!);
    flagged[0] = 1;
    await expectCode(readAll(write([head, frames[0]!, frames[1]!, flagged]), PASS), "DAMAGED");
    await expectCode(PackageReader.open(write([Buffer.from("not a package at all")]), PASS), "NOT_PACKAGE");
  });

  it("resumes a write after a checkpoint (a later request) and drops a half-written frame", async () => {
    const target = file();
    const first = await PackageWriter.create(target, PASS, FAST);
    await first.add("a", Buffer.from("first request"));
    const state = await first.checkpoint();
    const key = first.key;
    await first.close();
    fs.appendFileSync(target, Buffer.from("half a frame from a crash"));
    const second = await PackageWriter.resume(target, key, state);
    await second.add("b", Buffer.from("second request"));
    await second.finish({ parts: 2 });
    const entries = await readAll(target, PASS);
    expect(entries.map((entry) => `${entry.name}:${entry.data.toString()}`)).toEqual(["a:first request", "b:second request", 'manifest.json:{"parts":2}']);
  });

  it("resumes a read from the saved place after any entry, mid-frame included", async () => {
    const target = file();
    const writer = await PackageWriter.create(target, PASS, FAST);
    const sizes = [10, 700_000, 900_000, 5, 1_500_000, 3];
    for (const [index, size] of sizes.entries()) await writer.add(`e${index}`, crypto.randomBytes(size));
    await writer.finish({});
    const all = await readAll(target, PASS);
    const opened = await PackageReader.open(target, PASS);
    const key = opened.key;
    await opened.close();
    for (let cut = 0; cut < all.length - 1; cut += 1) {
      const reader = await PackageReader.open(target, { key });
      const rest: string[] = [];
      for await (const entry of reader.entries(all[cut]!.position)) rest.push(entry.name);
      await reader.close();
      expect(rest).toEqual(all.slice(cut + 1).map((entry) => entry.name));
    }
  });

  it("opens a server-key package with the server key or the typed key text", async () => {
    const serverKey = crypto.randomBytes(32);
    const target = file();
    const writer = await PackageWriter.create(target, { serverKey });
    await writer.add("head.json", "{}");
    await writer.finish({});
    expect((await readAll(target, { serverKey })).length).toBe(2);
    expect((await readAll(target, { passphrase: serverKey.toString("base64") })).length).toBe(2);
    await expectCode(PackageReader.open(target, { serverKey: crypto.randomBytes(32) }), "WRONG_SERVER_KEY");
    await expectCode(PackageReader.open(target, { passphrase: "not a key at all" }), "SERVER_KEY_NEEDED");
    expect(keyFromText(serverKey.toString("base64"))!.equals(serverKey)).toBe(true);
    expect(keyFromText("short")).toBeNull();
  });
});
