import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import * as engine from "@/scripts/database/arsbak-engine";
import * as arsdb from "@/scripts/database/arsbak-db";
import { fileSha256, PackageReader } from "@/scripts/database/arsbak";
import { getDbPool } from "@/lib/db/client";
import { getEnv } from "@/config/environment";
import { hitRateLimit } from "@/lib/db/repositories/jobs.repository";
import { decryptSecret } from "@/lib/security/encryption";
import { getSettingValue } from "@/server/settings/values";
import { signV4 } from "@/server/ops/offsite";
import { cachedKey, forgetKeys, rememberKey } from "@/server/ops/backup-centre/keys";
import { alertBackupEvent } from "@/server/ops/backup-centre/alerts";
import * as runs from "@/server/ops/backup-centre/runs";
import { appVersion, finishPackageFiles, newPackageName, packagePath, packagesDir, type PackageKind } from "@/server/ops/backup-centre/storage";
import { audit, CentreError, connect, explain, partialPath, receivePiece, serverKey, startUpload, STEP_BUDGET_MS, type Actor, type StepInput } from "@/server/ops/backup-centre/service";

// D-409 (v1.82.0, BK-1 part 2): moving the system between servers.
//  - App to app: the receiving Super Admin makes a one-time pairing code
//    (RECEIVE); the sending one types the address and code and the package
//    goes across in 8 MiB pieces (resumable). Or the other way round: the
//    source offers a package (OFFER) and the target pulls it.
//  - From a link (https) and to/from S3-compatible storage, in pieces.
//  - Database to database: this database is copied straight into another
//    MySQL (its details typed, the password never stored) with the same
//    staged switch, safety snapshot and undo as a restore.
//  - The check after a move: row counts, every file's checksum, sign-in.
// Pairing codes and the target password live only in the page's memory and
// are sent with each step, like the passphrase.

const PIECE = 8 * 1024 * 1024;
const PULL_PIECE = 16 * 1024 * 1024;
const PAIR_START_HOURS = 2;
const PAIR_USE_HOURS = 24;
const MAX_FAILURES = 20; // wrong codes per address per 15 minutes

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const normaliseCode = (code: string) => String(code ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase();

function needSecret(what: string): never {
  throw new CentreError(`Type the ${what} again to carry on (it is never stored).`, 400, "SECRET_NEEDED");
}

// Another server's address: https, or http only to this computer (a test or
// a VPS behind its own proxy on the same machine).
export function serverUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new CentreError("Type the other server's address, e.g. https://cms.example.com.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new CentreError("The address must start with https://.");
  if (url.username || url.password) throw new CentreError("Leave names and passwords out of the address.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

async function peer(url: string, init: RequestInit & { code?: string } = {}, timeout = 120_000): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.code) headers.set("x-pairing-code", init.code);
  try {
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeout), redirect: "error" });
  } catch (error) {
    throw new CentreError(`The other server didn't answer (${explain(error)}). Check the address and that it runs v1.82.0 or later.`);
  }
}

async function peerJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.success) throw new CentreError(`The other server refused: ${body?.error?.message ?? `HTTP ${response.status}`}`);
  return body.data as T;
}

// ---------- pairing codes (this server's side) ----------

export interface PairingView {
  id: number;
  purpose: "RECEIVE" | "OFFER";
  packageName: string | null;
  status: string;
  expiresAt: string;
  bytesSent: number;
  peerIp: string | null;
}

export async function createPairing(purpose: "RECEIVE" | "OFFER", packageName: string | null, actor: Actor): Promise<{ code: string; expiresAt: string }> {
  if (purpose === "OFFER") {
    const file = packagePath(packageName ?? "");
    if (!file || !fs.existsSync(file)) throw new CentreError("Choose a package on this server to offer.");
  }
  const raw = crypto.randomBytes(10).toString("hex"); // 80 bits, with a limit on wrong tries
  const code = raw.match(/.{4}/g)!.join("-");
  const [result] = await getDbPool().query<ResultSetHeader>(
    "INSERT INTO backup_pairings (purpose, code_hash, package_name, status, expires_at, created_by) VALUES (?, ?, ?, 'OPEN', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR), ?)",
    [purpose, sha256(raw), purpose === "OFFER" ? packageName : null, PAIR_START_HOURS, actor.id],
  );
  const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT expires_at FROM backup_pairings WHERE id = ?", [result.insertId]);
  await audit(actor, purpose === "RECEIVE" ? "BACKUP_PAIRING_RECEIVE" : "BACKUP_PAIRING_OFFER", packageName ?? String(result.insertId), {});
  return { code, expiresAt: new Date(row!.expires_at).toISOString() };
}

export async function listPairings(): Promise<PairingView[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT * FROM backup_pairings WHERE status IN ('OPEN', 'IN_USE') AND expires_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR) ORDER BY id DESC LIMIT 20",
    [PAIR_USE_HOURS],
  );
  return rows.map((row) => ({ id: Number(row.id), purpose: row.purpose, packageName: row.package_name ?? null, status: row.status, expiresAt: new Date(row.expires_at).toISOString(), bytesSent: Number(row.bytes_sent), peerIp: row.peer_ip ?? null }));
}

export async function revokePairing(id: number, actor: Actor): Promise<void> {
  await getDbPool().query("UPDATE backup_pairings SET status = 'REVOKED' WHERE id = ? AND status IN ('OPEN', 'IN_USE')", [id]);
  await audit(actor, "BACKUP_PAIRING_REVOKED", String(id), {});
}

// ---------- the machine side (called by another ARS-CMS) ----------

interface Pairing {
  id: number;
  purpose: "RECEIVE" | "OFFER";
  packageName: string | null;
  uploadId: number | null;
  status: string;
  createdBy: number | null;
}

// The pairing for a code, or a refusal that looks the same whatever was wrong.
// Wrong codes are counted per address; too many and every try is refused.
export async function pairingFor(code: string | null, purpose: "RECEIVE" | "OFFER", ip: string | null): Promise<Pairing> {
  const bucket = `backup-pair:ip:${ip ?? "unknown"}`;
  const [[failures]] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM rate_limit_hits WHERE bucket = ? AND occurred_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 900 SECOND)", [bucket]);
  if (Number(failures!.n) >= MAX_FAILURES) throw new CentreError("Too many wrong pairing codes. Try again in 15 minutes.", 429, "RATE_LIMITED");
  const raw = normaliseCode(code ?? "");
  const [rows] = raw.length === 20
    ? await getDbPool().query<RowDataPacket[]>(
        `SELECT * FROM backup_pairings WHERE code_hash = ? AND purpose = ?
           AND ((status = 'OPEN' AND expires_at > CURRENT_TIMESTAMP(3)) OR (status = 'IN_USE' AND created_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)))`,
        [sha256(raw), purpose, PAIR_USE_HOURS],
      )
    : [[] as RowDataPacket[]];
  const row = rows[0];
  if (!row) {
    await hitRateLimit(bucket, 900);
    throw new CentreError("The pairing code is wrong, used or expired. Make a new one on that server.", 403, "PAIRING_REFUSED");
  }
  return { id: Number(row.id), purpose: row.purpose, packageName: row.package_name ?? null, uploadId: row.upload_id === null ? null : Number(row.upload_id), status: row.status, createdBy: row.created_by === null ? null : Number(row.created_by) };
}

const machineActor = (pairing: Pairing, ip: string | null): Actor => ({ id: pairing.createdBy ?? 0, name: `another ARS-CMS (${ip ?? "unknown address"})` });

export async function receiveStart(input: { fileName: string; size: number }, code: string | null, ip: string | null): Promise<{ id: number; received: number }> {
  const pairing = await pairingFor(code, "RECEIVE", ip);
  if (pairing.uploadId) {
    const existing = await runs.getUpload(pairing.uploadId);
    if (existing && existing.status === "RECEIVING") return { id: existing.id, received: existing.sizeReceived };
    throw new CentreError("This pairing code was already used. Make a new one.", 409, "PAIRING_USED");
  }
  const id = await startUpload(input, machineActor(pairing, ip));
  const [result] = await getDbPool().query<ResultSetHeader>("UPDATE backup_pairings SET status = 'IN_USE', upload_id = ?, peer_ip = ? WHERE id = ? AND status = 'OPEN' AND upload_id IS NULL", [id, ip, pairing.id]);
  if (result.affectedRows !== 1) throw new CentreError("This pairing code was already used. Make a new one.", 409, "PAIRING_USED");
  return { id, received: 0 };
}

export async function receivePieceFrom(uploadId: number, offset: number, piece: Buffer, code: string | null, ip: string | null): Promise<{ received: number; size: number; packageName: string | null }> {
  const pairing = await pairingFor(code, "RECEIVE", ip);
  if (pairing.uploadId !== uploadId) throw new CentreError("That upload belongs to another pairing.", 403, "PAIRING_REFUSED");
  const result = await receivePiece(uploadId, offset, piece, machineActor(pairing, ip), { kind: "received", source: ip ?? "another server" });
  await getDbPool().query("UPDATE backup_pairings SET bytes_sent = ?, status = ? WHERE id = ?", [result.received, result.packageName ? "USED" : "IN_USE", pairing.id]);
  return result;
}

export async function offerInfo(code: string | null, ip: string | null): Promise<{ name: string; size: number; sha256: string | null }> {
  const pairing = await pairingFor(code, "OFFER", ip);
  const file = packagePath(pairing.packageName ?? "");
  if (!file || !fs.existsSync(file)) throw new CentreError("The offered package was removed from that server.", 404, "NOT_FOUND");
  await getDbPool().query("UPDATE backup_pairings SET status = 'IN_USE', peer_ip = ? WHERE id = ? AND status = 'OPEN'", [ip, pairing.id]);
  const sha = (await fsp.readFile(`${file}.sha256`, "utf8").catch(() => "")).trim().split(/\s+/)[0] || null;
  return { name: pairing.packageName!, size: (await fsp.stat(file)).size, sha256: sha };
}

export async function offerRead(code: string | null, ip: string | null, offset: number, length: number): Promise<Buffer> {
  const pairing = await pairingFor(code, "OFFER", ip);
  const file = packagePath(pairing.packageName ?? "");
  if (!file || !fs.existsSync(file)) throw new CentreError("The offered package was removed from that server.", 404, "NOT_FOUND");
  const size = (await fsp.stat(file)).size;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) throw new CentreError("Bad offset.");
  const want = Math.min(Math.max(1, length || PULL_PIECE), PULL_PIECE, size - offset);
  const handle = await fsp.open(file, "r");
  try {
    const buffer = Buffer.alloc(want);
    await handle.read(buffer, 0, want, offset);
    const done = offset + want >= size;
    await getDbPool().query("UPDATE backup_pairings SET bytes_sent = GREATEST(bytes_sent, ?), status = ?, peer_ip = ? WHERE id = ?", [offset + want, done ? "USED" : "IN_USE", ip, pairing.id]);
    if (done) {
      await audit({ id: pairing.createdBy ?? 0, name: `another ARS-CMS (${ip ?? "unknown"})` }, "BACKUP_MIGRATION_SENT", pairing.packageName, { pulledBy: ip });
      await alertBackupEvent("MIGRATION_SENT", `${pairing.packageName} was pulled by another server (${ip ?? "unknown address"}) with a pairing code.`, null);
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

// ---------- starting moves (this server's Super Admin) ----------

export async function startSend(input: { name: string; url: string }, actor: Actor): Promise<{ id: number; token: string }> {
  const file = packagePath(input.name);
  if (!file || !fs.existsSync(file)) throw new CentreError("Choose a package on this server to send.");
  const url = serverUrl(input.url);
  const created = await runs.createRun({ kind: "SEND", trigger: "MANUAL", phase: "send", packageName: input.name, options: { url, size: (await fsp.stat(file)).size }, createdBy: actor.id });
  await runs.saveStep(created.id, { phase: "send", state: { remoteId: null, offset: 0 }, progressDone: 0, progressTotal: 100, message: `Sending to ${new URL(url).host}…` });
  await audit(actor, "BACKUP_MIGRATION_SEND_STARTED", input.name, { to: new URL(url).host });
  return { id: created.id, token: created.token! };
}

export async function startPull(input: { url: string }, actor: Actor): Promise<{ id: number; token: string }> {
  const url = serverUrl(input.url);
  const name = newPackageName("received", crypto.randomBytes(3).toString("hex"));
  const created = await runs.createRun({ kind: "PULL", trigger: "MANUAL", phase: "pull", packageName: name, options: { url }, createdBy: actor.id });
  await runs.saveStep(created.id, { phase: "pull", state: { size: null, offset: 0 }, progressDone: 0, progressTotal: 100, message: `Asking ${new URL(url).host} for its package…` });
  await audit(actor, "BACKUP_MIGRATION_PULL_STARTED", name, { from: new URL(url).host });
  return { id: created.id, token: created.token! };
}

export async function startUrlFetch(input: { url: string }, actor: Actor): Promise<{ id: number; token: string }> {
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new CentreError("Paste the package's address (https://…).");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new CentreError("The address must start with https://.");
  const name = newPackageName("received", crypto.randomBytes(3).toString("hex"));
  const created = await runs.createRun({ kind: "URL_FETCH", trigger: "MANUAL", phase: "download", packageName: name, options: { host: url.host }, createdBy: actor.id });
  // The address may carry a signed token (e.g. a pre-signed S3 link), so it
  // is kept in this process's memory only, like a key; a restart asks again.
  urlMemory.set(created.id, url.toString());
  await runs.saveStep(created.id, { phase: "download", state: { size: null, offset: 0 }, progressDone: 0, progressTotal: 100, message: `Copying from ${url.host}…` });
  await audit(actor, "BACKUP_PACKAGE_FROM_LINK", name, { host: url.host });
  return { id: created.id, token: created.token! };
}
const urlMemory = new Map<number, string>();

// ---------- S3-compatible storage ----------

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export async function s3Config(): Promise<S3Config | null> {
  const [endpoint, region, bucket, accessKeyId, secretAccessKey] = await Promise.all(["backup.s3_endpoint", "backup.s3_region", "backup.s3_bucket", "backup.s3_access_key_id", "backup.s3_secret_access_key"].map((key) => getSettingValue(key).catch(() => null)));
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ""), region: region || "auto", bucket, accessKeyId, secretAccessKey };
}

async function s3(config: S3Config, method: string, key: string, query: Record<string, string>, body: Buffer | null, extra: Record<string, string> = {}): Promise<Response> {
  const qs = new URLSearchParams(query).toString();
  const url = `${config.endpoint}/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`;
  const payloadHash = crypto.createHash("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
  const headers = signV4({ method, url, headers: { ...extra, "x-amz-content-sha256": payloadHash }, payloadHash, region: config.region, service: "s3", accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, now: new Date() });
  delete headers.host;
  const response = await fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(300_000) });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CentreError(`The storage refused (${method} HTTP ${response.status}${/<Code>([^<]+)<\/Code>/.exec(text)?.[1] ? `: ${/<Code>([^<]+)<\/Code>/.exec(text)![1]}` : ""}). Check Providers & security → Off-site backup (the key must be allowed to read and write).`);
  }
  return response;
}

// Pure: the XML of a ListObjectsV2 answer → packages.
export function parseS3List(xml: string): { key: string; size: number; modified: string }[] {
  return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
    .map((match) => ({ key: /<Key>([^<]+)<\/Key>/.exec(match[1]!)?.[1] ?? "", size: Number(/<Size>(\d+)<\/Size>/.exec(match[1]!)?.[1] ?? 0), modified: /<LastModified>([^<]+)<\/LastModified>/.exec(match[1]!)?.[1] ?? "" }))
    .filter((item) => /\.arsbak$/.test(item.key))
    .map((item) => ({ ...item, key: item.key.replace(/&amp;/g, "&") }));
}

export async function listS3Packages(): Promise<{ key: string; size: number; modified: string }[]> {
  const config = await s3Config();
  if (!config) throw new CentreError("S3-compatible storage isn't set up (Providers & security → Off-site backup).");
  const response = await s3(config, "GET", "", { "list-type": "2", prefix: "ars-" }, null);
  return parseS3List(await response.text()).sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

export async function startS3Copy(name: string, actor: Actor): Promise<{ id: number; token: string }> {
  const file = packagePath(name);
  if (!file || !fs.existsSync(file)) throw new CentreError("That package isn't on the server any more.");
  if (!(await s3Config())) throw new CentreError("S3-compatible storage isn't set up (Providers & security → Off-site backup).");
  const created = await runs.createRun({ kind: "S3_COPY", trigger: "MANUAL", phase: "upload", packageName: name, options: { size: (await fsp.stat(file)).size }, createdBy: actor.id });
  await runs.saveStep(created.id, { phase: "upload", state: { uploadId: null, parts: [], offset: 0 }, progressDone: 0, progressTotal: 100, message: "Copying to S3 storage…" });
  await audit(actor, "BACKUP_PACKAGE_TO_S3", name, {});
  return { id: created.id, token: created.token! };
}

export async function startS3Fetch(input: { key: string; size: number }, actor: Actor): Promise<{ id: number; token: string }> {
  if (!/^[A-Za-z0-9._/-]{1,300}\.arsbak$/.test(input.key)) throw new CentreError("Pick a package from the S3 list.");
  const name = newPackageName("received", crypto.randomBytes(3).toString("hex"));
  const created = await runs.createRun({ kind: "S3_FETCH", trigger: "MANUAL", phase: "download", packageName: name, options: { key: input.key, size: input.size }, createdBy: actor.id });
  await runs.saveStep(created.id, { phase: "download", state: { size: input.size, offset: 0 }, progressDone: 0, progressTotal: 100, message: "Copying from S3 storage…" });
  await audit(actor, "BACKUP_PACKAGE_FROM_S3", name, { key: input.key });
  return { id: created.id, token: created.token! };
}

// ---------- database to database ----------

export interface TargetDb {
  host: string;
  port: number;
  user: string;
  database: string;
}

function remoteConnect(target: TargetDb, password: string) {
  return () => arsdb.openConnection({ host: target.host, port: target.port, user: target.user, password, database: target.database, connectTimeout: 15_000 });
}

export async function startDbCopy(input: TargetDb & { password: string; confirm: string; targetKey?: string | null }, actor: Actor): Promise<{ id: number; token: string; target: { tables: number; requests: number; version: string } }> {
  if (!/^[A-Za-z0-9.-]{1,255}$/.test(input.host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || !/^[A-Za-z0-9_$-]{1,64}$/.test(input.database) || !input.user) throw new CentreError("Check the target's host, port, user and database name.");
  if (input.confirm.trim() !== input.database) throw new CentreError(`Type the target database's name (${input.database}) to confirm: everything in it is replaced.`);
  const env = getEnv();
  if (input.database === env.DB_NAME && (input.host === env.DB_HOST || ["localhost", "127.0.0.1"].includes(input.host)) && input.port === env.DB_PORT) throw new CentreError("That is this server's own database.");
  if (input.targetKey && Buffer.from(input.targetKey.trim(), "base64").length !== 32) throw new CentreError("The target's ENCRYPTION_KEY must be the base64 text of 32 bytes (or leave it empty).");
  let info: { tables: number; requests: number; version: string };
  try {
    const remote = await remoteConnect(input, input.password)();
    try {
      const [[version]] = await remote.query<RowDataPacket[]>("SELECT VERSION() AS v");
      const tables = await arsdb.listTables(remote);
      let requests = 0;
      if (tables.some((table) => table.name === "approval_requests")) requests = await arsdb.exactCount(remote, "approval_requests");
      info = { tables: tables.length, requests, version: String(version!.v) };
    } finally {
      await remote.end();
    }
  } catch (error) {
    throw new CentreError(`Couldn't connect to the target database: ${explain(error)}. Allow this server's address there (e.g. cPanel → Remote MySQL) and check the details.`);
  }
  const created = await runs.createRun({ kind: "DB_COPY", trigger: "MANUAL", phase: "build", packageName: newPackageName("safety", "remote"), options: { target: { host: input.host, port: input.port, user: input.user, database: input.database }, targetInfo: info, rekey: Boolean(input.targetKey) }, createdBy: actor.id });
  const key = serverKey() ?? crypto.randomBytes(32);
  rememberKey(created.id, "package", key);
  if (input.targetKey) dbCopyKeys.set(created.id, Buffer.from(input.targetKey.trim(), "base64"));
  await runs.saveStep(created.id, { phase: "build", state: { build: null, snapshot: null, restore: null, rollback: null }, progressDone: 0, progressTotal: 100, message: "Reading this database…" });
  await audit(actor, "BACKUP_DB_COPY_STARTED", `${input.host}/${input.database}`.slice(0, 64), { target: `${input.host}:${input.port}/${input.database}`, targetTables: info.tables, targetRequests: info.requests });
  await alertBackupEvent("MIGRATION_SENT", `This database is being copied straight into ${input.database} on ${input.host} (everything there is replaced; a safety snapshot of it is made first).`, actor.name);
  return { id: created.id, token: created.token!, target: info };
}
const dbCopyKeys = new Map<number, Buffer>();

// ---------- the check after a move ----------

export async function startLiveCheck(restoreRunId: number, actor: Actor): Promise<{ id: number; token: string }> {
  const parent = await runs.getRun(restoreRunId);
  if (!parent || parent.kind !== "RESTORE" || parent.status !== "DONE") throw new CentreError("Choose a finished restore to check.");
  const created = await runs.createRun({ kind: "LIVE_CHECK", trigger: "MANUAL", phase: "rows", packageName: parent.packageName, parentRunId: parent.id, options: {}, createdBy: actor.id });
  await runs.saveStep(created.id, { phase: "rows", state: { fileIndex: 0, filesOk: 0, filesBad: [] }, progressDone: 0, progressTotal: 100, message: "Counting rows…" });
  return { id: created.id, token: created.token! };
}

// ---------- steps ----------

export async function moveStep(item: runs.BackupRun, input: StepInput, actor: Actor | null, budgetMs = STEP_BUDGET_MS): Promise<void> {
  switch (item.kind) {
    case "SEND":
      return sendStep(item, input, actor, budgetMs);
    case "PULL":
      return pullStep(item, input, actor, budgetMs);
    case "URL_FETCH":
      return urlStep(item, actor, budgetMs);
    case "S3_COPY":
      return s3CopyStep(item, budgetMs);
    case "S3_FETCH":
      return s3FetchStep(item, actor, budgetMs);
    case "DB_COPY":
      return dbCopyStep(item, input, actor, budgetMs);
    case "LIVE_CHECK":
      return liveCheckStep(item, budgetMs);
    default:
      throw new CentreError(`Unknown run ${item.kind}.`);
  }
}

const percent = (done: number, total: number) => Math.min(99, Math.floor((done / Math.max(1, total)) * 100));

async function sendStep(item: runs.BackupRun, input: StepInput, actor: Actor | null, budgetMs: number) {
  const started = Date.now();
  if (!input.secret) needSecret("pairing code");
  const code = normaliseCode(input.secret);
  const file = packagePath(item.packageName ?? "");
  if (!file || !fs.existsSync(file)) throw new CentreError("The package was removed from this server.");
  const url = String(item.options.url);
  const size = (await fsp.stat(file)).size;
  const state = { remoteId: null as number | null, offset: 0, ...((item.state as Record<string, unknown> | null) ?? {}) } as { remoteId: number | null; offset: number };
  if (!state.remoteId) {
    const opened = await peerJson<{ id: number; received: number }>(await peer(`${url}/api/backup-transfer/receive`, { method: "POST", code, headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: item.packageName, size }) }));
    state.remoteId = opened.id;
    state.offset = opened.received;
  }
  const handle = await fsp.open(file, "r");
  let finished = false;
  try {
    while (state.offset < size && Date.now() - started < budgetMs) {
      const piece = Buffer.alloc(Math.min(PIECE, size - state.offset));
      await handle.read(piece, 0, piece.length, state.offset);
      const answer = await peerJson<{ received: number; packageName: string | null }>(await peer(`${url}/api/backup-transfer/receive/${state.remoteId}?offset=${state.offset}`, { method: "PUT", code, headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(piece) }));
      state.offset = answer.received;
      if (answer.packageName) finished = true;
    }
  } finally {
    await handle.close();
  }
  if (!finished && state.offset < size) {
    await runs.saveStep(item.id, { phase: "send", state, progressDone: percent(state.offset, size), progressTotal: 100, message: `Sending to ${new URL(url).host}: ${percent(state.offset, size)}%…` });
    return;
  }
  await runs.finishRun(item.id, "DONE", { phase: "done", message: `Sent to ${new URL(url).host}. There: Packages on this server → the new "Received" package → Restore… (with this package's passphrase).` });
  await audit(actor, "BACKUP_MIGRATION_SENT", item.packageName, { to: new URL(url).host, bytes: size });
  await alertBackupEvent("MIGRATION_SENT", `${item.packageName} was sent to ${new URL(url).host}.`, actor?.name ?? null);
}

async function finishIncoming(item: runs.BackupRun, partial: string, source: string, actor: Actor | null, expectedSha: string | null) {
  const { header } = await PackageReader.readHeader(partial).catch(() => {
    throw new CentreError("What arrived isn't an ARS backup package.");
  });
  const sha = await fileSha256(partial);
  if (expectedSha && sha !== expectedSha) throw new CentreError("The copy doesn't match the sender's checksum. Try again.");
  await finishPackageFiles(partial, item.packageName!, sha, { kind: "received" as PackageKind, keyKind: header.kdf.alg === "server-key" ? "SERVER_KEY" : "PASSPHRASE", source, createdByName: actor?.name ?? null });
  await runs.finishRun(item.id, "DONE", { phase: "done", message: `Copied here as ${item.packageName}. Check it, then restore.` });
  await audit(actor, "BACKUP_MIGRATION_RECEIVED", item.packageName, { from: source });
  await alertBackupEvent("MIGRATION_RECEIVED", `${item.packageName} arrived from ${source}.`, actor?.name ?? null);
}

async function prepareIncoming(item: runs.BackupRun, offset: number): Promise<string> {
  const partial = partialPath(item.packageName!);
  await fsp.mkdir(packagesDir(), { recursive: true });
  if (offset === 0) await fsp.writeFile(partial, Buffer.alloc(0), { mode: 0o600 });
  const current = (await fsp.stat(partial).catch(() => null))?.size ?? 0;
  if (current !== offset) {
    if (current < offset) throw new CentreError("The partly copied file is shorter than recorded. Start again.");
    await fsp.truncate(partial, offset);
  }
  return partial;
}

async function pullStep(item: runs.BackupRun, input: StepInput, actor: Actor | null, budgetMs: number) {
  const started = Date.now();
  if (!input.secret) needSecret("pairing code");
  const code = normaliseCode(input.secret);
  const url = String(item.options.url);
  const state = { size: null as number | null, offset: 0, remoteName: null as string | null, sha256: null as string | null, ...((item.state as Record<string, unknown> | null) ?? {}) } as { size: number | null; offset: number; remoteName: string | null; sha256: string | null };
  if (state.size === null) {
    const info = await peerJson<{ name: string; size: number; sha256: string | null }>(await peer(`${url}/api/backup-transfer/offer`, { code }));
    state.size = info.size;
    state.remoteName = info.name;
    state.sha256 = info.sha256;
  }
  const partial = await prepareIncoming(item, state.offset);
  while (state.offset < state.size && Date.now() - started < budgetMs) {
    const response = await peer(`${url}/api/backup-transfer/offer?offset=${state.offset}&length=${PULL_PIECE}`, { code }, 300_000);
    if (!response.ok) await peerJson(response);
    const piece = Buffer.from(await response.arrayBuffer());
    if (!piece.length) throw new CentreError("The other server sent an empty piece.");
    await fsp.appendFile(partial, piece);
    state.offset += piece.length;
  }
  if (state.offset < state.size) {
    await runs.saveStep(item.id, { phase: "pull", state, progressDone: percent(state.offset, state.size), progressTotal: 100, message: `Copying ${state.remoteName} from ${new URL(url).host}: ${percent(state.offset, state.size)}%…` });
    return;
  }
  await finishIncoming(item, partial, `${new URL(url).host} (${state.remoteName})`, actor, state.sha256);
}

async function urlStep(item: runs.BackupRun, actor: Actor | null, budgetMs: number) {
  const started = Date.now();
  const url = urlMemory.get(item.id);
  if (!url) throw new CentreError("The server restarted, so the link was forgotten (it is never stored). Start the copy again.");
  const state = { size: null as number | null, offset: 0, ...((item.state as Record<string, unknown> | null) ?? {}) } as { size: number | null; offset: number };
  const partial = await prepareIncoming(item, state.offset);
  while ((state.size === null || state.offset < state.size) && Date.now() - started < budgetMs) {
    const response = await fetch(url, { headers: { range: `bytes=${state.offset}-${state.offset + PULL_PIECE - 1}` }, signal: AbortSignal.timeout(600_000), redirect: "follow" });
    if (response.status === 206) {
      const total = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1];
      if (total) state.size = Number(total);
      const piece = Buffer.from(await response.arrayBuffer());
      if (!piece.length) throw new CentreError("The link sent an empty piece.");
      await fsp.appendFile(partial, piece);
      state.offset += piece.length;
      if (state.size === null) state.size = state.offset; // unknown total: one piece
    } else if (response.ok && state.offset === 0) {
      // No ranges: the whole file in this step, written as it arrives.
      const out = fs.createWriteStream(partial);
      const reader = response.body!.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!out.write(Buffer.from(value))) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        state.offset += value.byteLength;
      }
      await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
      state.size = state.offset;
    } else {
      throw new CentreError(`The link answered HTTP ${response.status}.`);
    }
  }
  if (state.size === null || state.offset < state.size) {
    await runs.saveStep(item.id, { phase: "download", state, progressDone: state.size ? percent(state.offset, state.size) : 0, progressTotal: 100, message: `Copying from ${String(item.options.host)}…` });
    return;
  }
  urlMemory.delete(item.id);
  await finishIncoming(item, partial, String(item.options.host), actor, null);
}

async function s3CopyStep(item: runs.BackupRun, budgetMs: number) {
  const started = Date.now();
  const config = await s3Config();
  if (!config) throw new CentreError("S3-compatible storage isn't set up any more.");
  const file = packagePath(item.packageName ?? "");
  if (!file || !fs.existsSync(file)) throw new CentreError("The package isn't on the server any more.");
  const size = (await fsp.stat(file)).size;
  const key = item.packageName!;
  const state = { uploadId: null as string | null, parts: [] as { n: number; etag: string }[], offset: 0, ...((item.state as Record<string, unknown> | null) ?? {}) } as { uploadId: string | null; parts: { n: number; etag: string }[]; offset: number };
  if (!state.uploadId) {
    const xml = await (await s3(config, "POST", key, { uploads: "" }, null, { "content-type": "application/octet-stream" })).text();
    state.uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1] ?? null;
    if (!state.uploadId) throw new CentreError("The storage didn't start the upload.");
  }
  const handle = await fsp.open(file, "r");
  try {
    while (state.offset < size && Date.now() - started < budgetMs) {
      const piece = Buffer.alloc(Math.min(PIECE, size - state.offset));
      await handle.read(piece, 0, piece.length, state.offset);
      const n = state.parts.length + 1;
      const response = await s3(config, "PUT", key, { partNumber: String(n), uploadId: state.uploadId }, piece);
      state.parts.push({ n, etag: response.headers.get("etag") ?? "" });
      state.offset += piece.length;
    }
  } finally {
    await handle.close();
  }
  if (state.offset < size) {
    await runs.saveStep(item.id, { phase: "upload", state, progressDone: percent(state.offset, size), progressTotal: 100, message: `Copying to S3 storage: ${percent(state.offset, size)}%…` });
    return;
  }
  const body = `<CompleteMultipartUpload>${state.parts.map((part) => `<Part><PartNumber>${part.n}</PartNumber><ETag>${part.etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
  await s3(config, "POST", key, { uploadId: state.uploadId! }, Buffer.from(body), { "content-type": "application/xml" });
  await runs.finishRun(item.id, "DONE", { phase: "done", message: `${key} copied to the S3 bucket ${config.bucket}.` });
}

async function s3FetchStep(item: runs.BackupRun, actor: Actor | null, budgetMs: number) {
  const started = Date.now();
  const config = await s3Config();
  if (!config) throw new CentreError("S3-compatible storage isn't set up any more.");
  const size = Number(item.options.size);
  const state = { offset: 0, ...((item.state as Record<string, unknown> | null) ?? {}) } as { offset: number };
  const partial = await prepareIncoming(item, state.offset);
  while (state.offset < size && Date.now() - started < budgetMs) {
    const end = Math.min(size, state.offset + PULL_PIECE) - 1;
    const response = await s3(config, "GET", String(item.options.key), {}, null, { range: `bytes=${state.offset}-${end}` });
    const piece = Buffer.from(await response.arrayBuffer());
    if (!piece.length) throw new CentreError("The storage sent an empty piece.");
    await fsp.appendFile(partial, piece);
    state.offset += piece.length;
  }
  if (state.offset < size) {
    await runs.saveStep(item.id, { phase: "download", state, progressDone: percent(state.offset, size), progressTotal: 100, message: `Copying from S3 storage: ${percent(state.offset, size)}%…` });
    return;
  }
  await finishIncoming(item, partial, `S3 ${config.bucket}/${String(item.options.key)}`, actor, null);
}

type DbCopyState = { build: engine.BuildState | null; snapshot: engine.BuildState | null; restore: engine.RestoreState | null; rollback: { restore: engine.RestoreState | null } | null };

const copyFile = (item: runs.BackupRun) => path.join(packagesDir(), `.dbcopy-${item.id}.arsbak.part`);
const copyDir = (item: runs.BackupRun) => path.join(packagesDir(), `.dbcopy-${item.id}-files`);

async function dbCopyStep(item: runs.BackupRun, input: StepInput, actor: Actor | null, budgetMs: number) {
  if (!input.secret) needSecret("target database password");
  rememberPassword(item.id, input.secret);
  const target = item.options.target as TargetDb;
  const remote = remoteConnect(target, input.secret);
  const key = cachedKey(item.id, "package") ?? serverKey();
  if (!key) throw new CentreError("The server restarted during the copy and its working key was in memory only. Start the copy again (the target was not switched yet, or the undo has run).");
  const state = (item.state as DbCopyState | null) ?? { build: null, snapshot: null, restore: null, rollback: null };
  const secret = { serverKey: key };
  if (item.phase === "build") {
    const result = await engine.buildStep({ file: copyFile(item), ...(state.build ? { key } : { secret }), connect, uploadDir: copyDir(item), include: { database: true, files: false, secrets: false }, head: { appVersion: appVersion(), kind: "dbcopy" } }, state.build, Math.max(budgetMs, 20_000));
    if (!state.build && result.key) rememberKey(item.id, "package", result.key);
    const next = { ...state, build: result.state };
    await runs.saveStep(item.id, { phase: result.done ? "snapshot" : "build", state: next, progressDone: result.done ? 25 : Math.floor((result.state.progress.done / Math.max(1, result.state.progress.total)) * 25), progressTotal: 100, message: result.done ? "Copied this database. Making a safety snapshot of the target…" : "Reading this database…" });
    return;
  }
  if (item.phase === "snapshot") {
    const name = item.packageName!;
    const result = await engine.buildStep({ file: partialPath(name), ...(state.snapshot ? { key } : { secret }), connect: remote, uploadDir: copyDir(item), include: { database: true, files: false, secrets: false }, head: { appVersion: "target", kind: "safety", source: { url: `${target.host}:${target.port}`, database: target.database } } }, state.snapshot, budgetMs);
    const next = { ...state, snapshot: result.state };
    if (!result.done) {
      await runs.saveStep(item.id, { phase: "snapshot", state: next, progressDone: 25 + Math.floor((result.state.progress.done / Math.max(1, result.state.progress.total)) * 20), progressTotal: 100, message: "Safety snapshot of the target database…" });
      return;
    }
    await finishPackageFiles(partialPath(name), name, result.state.sha256!, { kind: "safety", keyKind: serverKey() ? "SERVER_KEY" : "PASSPHRASE", source: `target ${target.host}/${target.database} before the database copy${serverKey() ? "" : " (opens only while this copy runs)"}`, createdByName: actor?.name ?? null });
    await runs.saveStep(item.id, { phase: "load", state: { ...next, snapshot: { ...result.state, tables: [], counts: {} } }, progressDone: 45, progressTotal: 100, message: "Loading into the target beside its live tables…" });
    return;
  }
  if (item.phase === "rollback") {
    const snapshotFile = packagePath(item.packageName!)!;
    const result = await engine.restoreStep({ file: snapshotFile, key, connect: remote, uploadDir: copyDir(item), mode: "database", runId: `dbrb${item.id}` }, state.rollback?.restore ?? null, budgetMs);
    if (!result.done) {
      await runs.saveStep(item.id, { phase: "rollback", state: { ...state, rollback: { restore: result.state } }, message: "The copy failed; putting the target's snapshot back…" });
      return;
    }
    await cleanupCopy(item);
    forgetKeys(item.id);
    await runs.finishRun(item.id, "ROLLED_BACK", { phase: "done", message: "The copy failed, so the target database was put back from its safety snapshot." });
    return;
  }
  // load → swap → verify → finalize on the target
  const targetKey = dbCopyKeys.get(item.id) ?? null;
  const thisKey = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  const result = await engine.restoreStep(
    { file: copyFile(item), key, connect: remote, uploadDir: copyDir(item), mode: "database", runId: `db${item.id}`, sourceEncryptionKey: targetKey && thisKey.length === 32 ? thisKey : null, targetEncryptionKey: targetKey },
    state.restore,
    budgetMs,
  );
  const next = { ...state, restore: result.state };
  if (!result.done) {
    await runs.saveStep(item.id, { phase: result.state.phase, state: next, progressDone: result.state.phase === "load" ? 60 : 85, progressTotal: 100, message: result.state.phase === "load" ? `Loading into the target (${result.state.tablesSeen.length} tables so far); its live data is untouched until the switch.` : "Switching the target to the copied data…" });
    return;
  }
  await cleanupCopy(item);
  dbCopyKeys.delete(item.id);
  forgetKeys(item.id);
  const summary = { tables: result.state.swap?.restored.length ?? 0, rekeyed: result.state.rekeyed ?? 0, warnings: result.state.warnings, snapshot: item.packageName, target: target };
  await runs.finishRun(item.id, "DONE", {
    phase: "done",
    summary,
    message: `Copied ${summary.tables} tables into ${target.database} on ${target.host}. Next, on that app: restart or publish it (its migrations run at start), copy the attachments there (send a full package, or Attachments only), and ${summary.rekeyed ? "keep its own ENCRYPTION_KEY (stored keys were re-keyed for it)" : "set its ENCRYPTION_KEY to this server's, or the stored provider keys can't be read there"}. Everyone there signs in again.${summary.warnings.length ? ` ${summary.warnings.join(" ")}` : ""}`,
  });
  await audit(actor, "BACKUP_DB_COPY_DONE", `${target.host}/${target.database}`.slice(0, 64), summary);
  await alertBackupEvent("MIGRATION_SENT", `This database was copied into ${target.database} on ${target.host}.`, actor?.name ?? null);
}

async function cleanupCopy(item: runs.BackupRun) {
  await engine.discardBuild(copyFile(item));
  await fsp.rm(copyDir(item), { recursive: true, force: true });
}

// A database copy that failed: before the target's old tables are dropped the
// switch is undone; after, the target's safety snapshot goes back.
export async function failDbCopy(item: runs.BackupRun, error: unknown, actor: Actor | null): Promise<void> {
  const message = explain(error);
  const state = (item.state as DbCopyState | null) ?? { build: null, snapshot: null, restore: null, rollback: null };
  const engineState = (error as { state?: engine.RestoreState }).state ?? state.restore;
  if (["build", "snapshot"].includes(item.phase) || item.phase === "rollback" || !engineState) {
    await cleanupCopy(item);
    if (item.phase === "snapshot") await engine.discardBuild(partialPath(item.packageName!));
    forgetKeys(item.id);
    await runs.finishRun(item.id, "FAILED", { error: message, message: item.phase === "rollback" ? `The copy failed and so did putting the snapshot back. Restore ${item.packageName} into the target (DEPLOYMENT Part P4).` : "The copy stopped before the target was changed." });
    await alertBackupEvent("RESTORE_FAILED", `Copying the database to another server failed: ${message}`, actor?.name ?? null);
    return;
  }
  // Without the password the target can't be reached: the page sends it again.
  const target = item.options.target as TargetDb;
  const password = lastPasswords.get(item.id);
  const ctx = { file: copyFile(item), key: Buffer.alloc(32), connect: remoteConnect(target, password ?? ""), uploadDir: copyDir(item), mode: "database" as const, runId: `db${item.id}` };
  const undone = await engine.rollbackRestore(ctx, engineState).catch(() => false);
  if (undone) {
    await cleanupCopy(item);
    forgetKeys(item.id);
    await runs.finishRun(item.id, engineState.swap ? "ROLLED_BACK" : "FAILED", { error: message, message: engineState.swap ? "The copy failed after the switch, so the target was switched straight back." : "The copy stopped while loading; the target's live data was never touched." });
    await alertBackupEvent(engineState.swap ? "ROLLED_BACK" : "RESTORE_FAILED", `Copying the database to ${target.host} failed (${message}); the target is as it was.`, actor?.name ?? null);
    return;
  }
  await runs.saveStep(item.id, { phase: "rollback", state: { ...state, restore: engineState, rollback: { restore: null } }, message: `The copy failed (${message}). Putting the target's snapshot back…` });
}
const lastPasswords = new Map<number, string>();

// A move stopped before anything changed: remove what it left.
export async function abandonMove(item: runs.BackupRun): Promise<void> {
  if (["PULL", "URL_FETCH", "S3_FETCH"].includes(item.kind)) await fsp.rm(partialPath(item.packageName ?? "x"), { force: true });
  urlMemory.delete(item.id);
  if (item.kind !== "DB_COPY") return;
  const state = (item.state as DbCopyState | null) ?? null;
  if (item.phase === "snapshot") await engine.discardBuild(partialPath(item.packageName!));
  if (item.phase === "load" && state?.restore) {
    const password = lastPasswords.get(item.id);
    if (password) await engine.rollbackRestore({ file: copyFile(item), key: Buffer.alloc(32), connect: remoteConnect(item.options.target as TargetDb, password), uploadDir: copyDir(item), mode: "database", runId: `db${item.id}` }, state.restore).catch(() => undefined);
  }
  await cleanupCopy(item);
  dbCopyKeys.delete(item.id);
  lastPasswords.delete(item.id);
}
export function rememberPassword(runId: number, password: string | null | undefined) {
  if (password) lastPasswords.set(runId, password);
}

async function liveCheckStep(item: runs.BackupRun, budgetMs: number) {
  const started = Date.now();
  const parent = await runs.getRun(item.parentRunId ?? 0);
  const manifest = ((parent?.state as { restore?: { manifest?: { tables?: Record<string, { rows: number }>; files?: { p: string; sha256: string }[] } } } | null)?.restore?.manifest) ?? null;
  if (!parent || !manifest) throw new CentreError("The restore's record is gone, so there is nothing to compare with.");
  const state = { fileIndex: 0, filesOk: 0, filesBad: [] as string[], rows: null as unknown, ...((item.state as Record<string, unknown> | null) ?? {}) } as { fileIndex: number; filesOk: number; filesBad: string[]; rows: { table: string; expected: number; now: number }[] | null };
  if (item.phase === "rows") {
    const restored = (parent.state as { restore?: { swap?: { restored?: string[] } } }).restore?.swap?.restored ?? [];
    const connection = await connect();
    const rows: { table: string; expected: number; now: number }[] = [];
    try {
      for (const table of restored) rows.push({ table, expected: Number(manifest.tables?.[table]?.rows ?? 0), now: await arsdb.exactCount(connection, table).catch(() => -1) });
    } finally {
      await connection.end();
    }
    await runs.saveStep(item.id, { phase: "files", state: { ...state, rows }, progressDone: 30, progressTotal: 100, message: "Checking every attachment's checksum…" });
    return;
  }
  if (item.phase === "files") {
    const files = parent.mode === "full" || parent.mode === "files" ? (manifest.files ?? []) : [];
    const root = path.resolve(getEnv().UPLOAD_DIR ?? path.join(process.cwd(), "storage", "uploads"));
    while (state.fileIndex < files.length && Date.now() - started < budgetMs) {
      const entry = files[state.fileIndex]!;
      const hash = await fileSha256(path.join(root, ...engine.safeRelative(entry.p).split("/"))).catch(() => null);
      if (hash === entry.sha256) state.filesOk += 1;
      else if (state.filesBad.length < 50) state.filesBad.push(entry.p);
      state.fileIndex += 1;
    }
    const done = state.fileIndex >= files.length;
    await runs.saveStep(item.id, { phase: done ? "signin" : "files", state, progressDone: done ? 80 : 30 + Math.floor((state.fileIndex / Math.max(1, files.length)) * 50), progressTotal: 100, message: done ? "Checking sign-in…" : `Checking attachments: ${state.fileIndex} of ${files.length}…` });
    return;
  }
  // signin: can someone sign in here, and can the app read its stored keys?
  const checks = await signInChecks();
  const rowsDiffer = (state.rows ?? []).filter((row) => row.now !== row.expected);
  const summary = { rows: state.rows, rowsDiffer: rowsDiffer.length, filesOk: state.filesOk, filesBad: state.filesBad, checks };
  const ok = rowsDiffer.length === 0 && state.filesBad.length === 0 && checks.every((check) => check.ok);
  await runs.finishRun(item.id, "DONE", {
    phase: "done",
    summary,
    message: ok
      ? `All good: ${(state.rows ?? []).length} tables hold the rows of the package, ${state.filesOk} attachments match their checksums, and sign-in is ready.`
      : `Checked: ${rowsDiffer.length} table(s) hold a different number of rows than the package (normal for tables the migrations or new activity changed since), ${state.filesBad.length} attachment(s) missing or different, ${checks.filter((check) => !check.ok).length} sign-in check(s) to fix. See the details.`,
  });
}

export async function signInChecks(): Promise<{ name: string; ok: boolean; detail: string }[]> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const [[superAdmins]] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'SUPER_ADMIN' AND u.active = TRUE");
  checks.push({ name: "An active Super Admin", ok: Number(superAdmins!.n) > 0, detail: `${Number(superAdmins!.n)} active` });
  const secret = process.env.SESSION_SECRET ?? "";
  checks.push({ name: "SESSION_SECRET", ok: secret.length >= 32, detail: secret.length >= 32 ? "set" : "missing or too short: nobody can stay signed in" });
  const [encrypted] = await getDbPool().query<RowDataPacket[]>("SELECT setting_key, value FROM system_settings WHERE encrypted = TRUE AND value IS NOT NULL AND value <> '' LIMIT 20");
  let readable = 0;
  for (const row of encrypted) {
    try {
      decryptSecret(String(row.value));
      readable += 1;
    } catch {
      // counted below
    }
  }
  checks.push({ name: "Stored provider keys readable (ENCRYPTION_KEY)", ok: readable === encrypted.length, detail: encrypted.length ? `${readable} of ${encrypted.length} readable${readable < encrypted.length ? ": set ENCRYPTION_KEY to the value the data was made with (see the package's secrets)" : ""}` : "none stored" });
  const firebase = Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
  checks.push({ name: "Google sign-in (Firebase)", ok: firebase, detail: firebase ? "set" : "FIREBASE_* not set: only User ID + WhatsApp code sign-in works" });
  const base = process.env.APP_BASE_URL ?? "";
  checks.push({ name: "APP_BASE_URL", ok: /^https:\/\//.test(base) || /^http:\/\/localhost/.test(base), detail: base || "not set: links in emails won't work" });
  return checks;
}

// Pure: a ready .env for this server: its own database, keys and folders,
// the package's values for everything else.
export function envFileFor(packageEnv: Record<string, string>, here: Record<string, string | undefined>): string {
  const keepHere = new Set(["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "ENCRYPTION_KEY", "UPLOAD_DIR", "BACKUP_DIR", "APP_BASE_URL"]);
  const names = [...new Set([...engine.SECRET_ENV])];
  const lines = ["# ARS CMS .env made by Backup, restore & migrate (keep it private; never commit it)"];
  for (const name of names) {
    const value = keepHere.has(name) && here[name] ? here[name]! : packageEnv[name];
    if (value === undefined || value === "") continue;
    lines.push(`${name}=${/[\s#"']/.test(value) ? JSON.stringify(value) : value}`);
  }
  return `${lines.join("\n")}\n`;
}
