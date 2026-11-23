import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDbPool } from "@/lib/db/client";
import { resetEnvCacheForTests } from "@/config/environment";
import { encryptSecret } from "@/lib/security/encryption";
import { createUser } from "./helpers";

// D-409 (v1.82.0, BK-1 part 2): moving the system. App to app both ways
// (send with a RECEIVE code, pull with an OFFER code) through the real
// machine handlers, wrong codes refused and rate-limited, S3 multipart copy
// and ranged fetch against a stand-in bucket, a link, the database copy into
// another MySQL with its safety snapshot, and the check after a restore.
const host = process.env.TEST_DB_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_DB_PORT ?? 3307);
const user = process.env.TEST_DB_USER ?? "ars_dev";
const password = process.env.TEST_DB_PASSWORD ?? "ars_dev_password";
const rootPassword = process.env.TEST_DB_ROOT_PASSWORD ?? "ars_root_password";
const sourceDb = process.env.DB_NAME ?? "ars_approvals_test";
const targetDb = `${sourceDb}_copy`.slice(0, 64);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ars-bk-moves-"));
const PASSPHRASE = "moves test passphrase 2026";
type Service = typeof import("@/server/ops/backup-centre/service");
type Moves = typeof import("@/server/ops/backup-centre/moves");
let service: Service;
let moves: Moves;
let actor: { id: number; name: string };
let packageName: string;
const realFetch = globalThis.fetch;

const root = () => mysql.createConnection({ host, port, user: "root", password: rootPassword });
const envelope = (data: unknown, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: { message: String(data) } }), { status, headers: { "content-type": "application/json" } });

// "The other server" is this one, reached through its own machine handlers.
async function peerFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const code = new Headers(init.headers).get("x-pairing-code");
  try {
    if (url.pathname === "/api/backup-transfer/receive") return envelope(await moves.receiveStart(JSON.parse(String(init.body)), code, "203.0.113.9"));
    const piece = /^\/api\/backup-transfer\/receive\/(\d+)$/.exec(url.pathname);
    if (piece) return envelope(await moves.receivePieceFrom(Number(piece[1]), Number(url.searchParams.get("offset")), Buffer.from(init.body as Uint8Array), code, "203.0.113.9"));
    if (url.pathname === "/api/backup-transfer/offer") {
      if (url.searchParams.get("offset") === null) return envelope(await moves.offerInfo(code, "203.0.113.9"));
      return new Response(new Uint8Array(await moves.offerRead(code, "203.0.113.9", Number(url.searchParams.get("offset")), Number(url.searchParams.get("length")))));
    }
  } catch (error) {
    return envelope((error as Error).message, (error as { status?: number }).status ?? 500);
  }
  return new Response("not found", { status: 404 });
}

async function drive(id: number, input: { passphrase?: string; secret?: string } = {}) {
  for (let steps = 0; steps < 500; steps += 1) {
    const view = await service.stepRun(id, input, actor, 5_000);
    if (view.status !== "RUNNING") return view;
  }
  throw new Error("run did not finish");
}

const shaOf = (name: string) => fs.readFileSync(path.join(work, "backups", "packages", `${name}.sha256`), "utf8").split(" ")[0];

beforeAll(async () => {
  process.env.BACKUP_DIR = path.join(work, "backups");
  delete process.env.BACKUP_ENCRYPTION_KEY;
  resetEnvCacheForTests();
  service = await import("@/server/ops/backup-centre/service");
  moves = await import("@/server/ops/backup-centre/moves");
  actor = { id: await createUser({ name: "Mover", roles: ["SUPER_ADMIN"] }), name: "Mover" };
  await getDbPool().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('features.backup_centre', 'FEATURES', 'STRING', FALSE, 'ON') ON DUPLICATE KEY UPDATE value = 'ON'");
  const started = await service.startBackup({ include: "database", keepOnServer: true, copyToDrive: false, passphrase: PASSPHRASE }, actor);
  packageName = (await drive(started.id, { passphrase: PASSPHRASE })).packageName!;
  const connection = await root();
  await connection.query(`DROP DATABASE IF EXISTS \`${targetDb}\``);
  await connection.query(`CREATE DATABASE \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`GRANT ALL PRIVILEGES ON \`${targetDb}\`.* TO ?@'%'`, [user]);
  await connection.end();
}, 300_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.BACKUP_DIR;
  resetEnvCacheForTests();
  await getDbPool().query("DELETE FROM system_settings WHERE setting_key LIKE 'backup.s3%' OR setting_key = 'features.backup_centre'");
  await getDbPool().query("DELETE FROM rate_limit_hits WHERE bucket LIKE 'backup-pair:%'");
  await getDbPool().end();
  const connection = await root();
  await connection.query(`DROP DATABASE IF EXISTS \`${targetDb}\``);
  await connection.end();
  fs.rmSync(work, { recursive: true, force: true });
});

describe("moving the system (D-409)", { timeout: 300_000 }, () => {
  it("sends a package app to app with a one-time RECEIVE code", async () => {
    vi.stubGlobal("fetch", peerFetch);
    const { code } = await moves.createPairing("RECEIVE", null, actor);
    expect(code).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/);
    const [[stored]] = await getDbPool().query<RowDataPacket[]>("SELECT code_hash FROM backup_pairings ORDER BY id DESC LIMIT 1");
    expect(String(stored!.code_hash)).not.toContain(code.replace(/-/g, "")); // only the hash
    const started = await moves.startSend({ name: packageName, url: "http://localhost:3999" }, actor);
    await expect(service.stepRun(started.id, {}, actor)).rejects.toMatchObject({ code: "SECRET_NEEDED" });
    const done = await drive(started.id, { secret: code.toUpperCase() });
    expect(done.status).toBe("DONE");
    const received = (await service.centreSnapshot()).packages.find((item) => item.kind === "received");
    expect(received).toBeTruthy();
    expect(shaOf(received!.name)).toBe(shaOf(packageName));
    // The code is used up.
    await expect(moves.receiveStart({ fileName: "x.arsbak", size: 100 }, code, "203.0.113.9")).rejects.toMatchObject({ code: "PAIRING_REFUSED" });
  });

  it("refuses wrong codes and then every try from that address for a while", async () => {
    await getDbPool().query("DELETE FROM rate_limit_hits WHERE bucket LIKE 'backup-pair:%'");
    for (let tries = 0; tries < 20; tries += 1) await expect(moves.offerInfo("0000-0000-0000-0000-0000", "198.51.100.7")).rejects.toMatchObject({ code: "PAIRING_REFUSED" });
    await expect(moves.offerInfo("0000-0000-0000-0000-0000", "198.51.100.7")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(moves.serverUrl.bind(null, "http://cms.example.com")).toThrow(/https/);
    expect(moves.serverUrl("https://cms.example.com/")).toBe("https://cms.example.com");
  });

  it("pulls a package offered by another server with an OFFER code", async () => {
    vi.stubGlobal("fetch", peerFetch);
    const { code } = await moves.createPairing("OFFER", packageName, actor);
    const started = await moves.startPull({ url: "http://127.0.0.1:3999" }, actor);
    const done = await drive(started.id, { secret: code });
    expect(done.status).toBe("DONE");
    expect(shaOf(done.packageName!)).toBe(shaOf(packageName));
    const [[pairing]] = await getDbPool().query<RowDataPacket[]>("SELECT status, bytes_sent FROM backup_pairings ORDER BY id DESC LIMIT 1");
    expect(pairing!.status).toBe("USED");
  });

  it("copies to S3 in parts and back with ranged reads, and from a link", async () => {
    const bucket = new Map<string, Buffer>();
    const parts = new Map<string, Buffer[]>();
    vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const key = decodeURIComponent(url.pathname.replace(/^\/bucket\/?/, ""));
      const method = init.method ?? "GET";
      // Every bucket call is signed (a plain link isn't).
      if (url.search) expect(new Headers(init.headers).get("authorization") ?? "").toMatch(/^AWS4-HMAC-SHA256 /);
      if (method === "POST" && url.searchParams.has("uploads")) return new Response(`<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>`);
      if (method === "PUT" && url.searchParams.has("partNumber")) {
        parts.set(key, [...(parts.get(key) ?? []), Buffer.from(init.body as Uint8Array)]);
        return new Response(null, { headers: { etag: `"p${url.searchParams.get("partNumber")}"` } });
      }
      if (method === "POST" && url.searchParams.has("uploadId")) {
        expect(String(Buffer.from(init.body as Uint8Array))).toContain("<PartNumber>1</PartNumber>");
        bucket.set(key, Buffer.concat(parts.get(key) ?? []));
        return new Response("<CompleteMultipartUploadResult/>");
      }
      if (method === "GET" && url.searchParams.get("list-type") === "2") return new Response(`<ListBucketResult>${[...bucket].map(([name, body]) => `<Contents><Key>${name}</Key><Size>${body.length}</Size><LastModified>2026-11-23T10:00:00Z</LastModified></Contents>`).join("")}</ListBucketResult>`);
      if (method === "GET") {
        const body = bucket.get(key)!;
        const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get("range") ?? "");
        if (!range) return new Response(new Uint8Array(body));
        return new Response(new Uint8Array(body.subarray(Number(range[1]), Number(range[2]) + 1)), { status: 206, headers: { "content-range": `bytes ${range[1]}-${range[2]}/${body.length}` } });
      }
      return new Response("no", { status: 400 });
    });
    for (const [key, value] of [["backup.s3_endpoint", "https://s3.example.test"], ["backup.s3_bucket", "bucket"], ["backup.s3_region", "auto"], ["backup.s3_access_key_id", "AKIDTEST"]]) {
      await getDbPool().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'BACKUP', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
    }
    await getDbPool().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('backup.s3_secret_access_key', 'BACKUP', 'STRING', TRUE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [encryptSecret("secret-test-key")]);
    const copied = await drive((await moves.startS3Copy(packageName, actor)).id);
    expect(copied.error).toBeNull();
    expect(copied.status).toBe("DONE");
    const listed = await moves.listS3Packages();
    expect(listed.map((item) => item.key)).toEqual([packageName]);
    const fetched = await drive((await moves.startS3Fetch({ key: listed[0]!.key, size: listed[0]!.size }, actor)).id);
    expect(fetched.error).toBeNull();
    expect(fetched.status).toBe("DONE");
    expect(shaOf(fetched.packageName!)).toBe(shaOf(packageName));
    // A link (here the same stand-in, answering ranges).
    const linked = await drive((await moves.startUrlFetch({ url: `https://s3.example.test/bucket/${packageName}` }, actor)).id);
    expect(linked.error).toBeNull();
    expect(linked.status).toBe("DONE");
    expect(shaOf(linked.packageName!)).toBe(shaOf(packageName));
    vi.stubGlobal("fetch", realFetch);
  });

  it("copies this database straight into another MySQL, with a safety snapshot of it first", async () => {
    vi.stubGlobal("fetch", realFetch);
    const target = await mysql.createConnection({ host, port, user, password, database: targetDb });
    await target.query("CREATE TABLE before_copy (id INT PRIMARY KEY) ENGINE=InnoDB");
    await target.query("INSERT INTO before_copy VALUES (7)");
    await target.end();
    const details = { host, port, user, database: targetDb, password };
    await expect(moves.startDbCopy({ ...details, confirm: "nope" }, actor)).rejects.toThrow(/to confirm/);
    await expect(moves.startDbCopy({ ...details, password: "wrong password", confirm: targetDb }, actor)).rejects.toThrow(/Couldn't connect/);
    await expect(moves.startDbCopy({ ...details, database: sourceDb, confirm: sourceDb, host: "127.0.0.1" }, actor)).rejects.toThrow(/own database/);
    const started = await moves.startDbCopy({ ...details, confirm: targetDb }, actor);
    expect(started.target.tables).toBe(1);
    const done = await drive(started.id, { secret: password });
    expect(done.error).toBeNull();
    expect(done.status).toBe("DONE");
    const sum = async (database: string) => {
      const connection = await mysql.createConnection({ host, port, user, password, database });
      const [tables] = await connection.query<RowDataPacket[]>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name NOT IN ('backup_runs', 'backup_uploads', 'backup_pairings', 'ops_restores', 'schema_migration_progress', 'rate_limit_hits', 'audit_logs', 'notifications', 'notification_deliveries', 'notification_outbox') ORDER BY table_name");
      const out: Record<string, string> = {};
      for (const row of tables) out[String(row.name)] = String(((await connection.query<RowDataPacket[]>(`CHECKSUM TABLE \`${row.name}\``))[0][0]!).Checksum);
      await connection.end();
      return out;
    };
    const a = await sum(sourceDb);
    const b = await sum(targetDb);
    expect(Object.keys(b)).not.toContain("before_copy");
    expect(Object.keys(a).filter((name) => a[name] !== b[name])).toEqual([]);
    const snapshot = (await service.centreSnapshot()).packages.find((item) => item.name === done.packageName);
    expect(snapshot?.kind).toBe("safety");
  });

  it("checks the system after a restore: rows, files and sign-in", async () => {
    const verify = await service.startVerify({ name: packageName, passphrase: PASSPHRASE }, actor);
    await drive(verify.id, { passphrase: PASSPHRASE });
    const restore = await service.startRestore({ verifyRunId: verify.id, mode: "tables", tables: ["designations"], confirm: process.env.DB_NAME!, acceptWarnings: true }, actor);
    expect((await drive(restore.id, { passphrase: PASSPHRASE })).status).toBe("DONE");
    const check = await drive((await moves.startLiveCheck(restore.id, actor)).id);
    expect(check.status).toBe("DONE");
    const summary = check.summary as { rows: { table: string; expected: number; now: number }[]; checks: { name: string; ok: boolean }[] };
    expect(summary.rows.map((row) => row.table)).toEqual(["designations"]);
    expect(summary.rows[0]!.now).toBe(summary.rows[0]!.expected);
    expect(summary.checks.find((item) => item.name === "An active Super Admin")?.ok).toBe(true);
    expect(summary.checks.find((item) => item.name === "SESSION_SECRET")?.ok).toBe(true);
  });

  it("writes a ready .env: this server's database and keys, the package's other values", () => {
    const text = moves.envFileFor({ DB_HOST: "old-host", ENCRYPTION_KEY: "old", SESSION_SECRET: "from package", FIREBASE_PRIVATE_KEY: "-----BEGIN KEY-----\nabc" }, { DB_HOST: "new-host", ENCRYPTION_KEY: "new" });
    expect(text).toContain("DB_HOST=new-host");
    expect(text).toContain("ENCRYPTION_KEY=new");
    expect(text).toContain('SESSION_SECRET="from package"');
    expect(text).toContain('FIREBASE_PRIVATE_KEY="-----BEGIN KEY-----\\nabc"');
    expect(moves.parseS3List("<Contents><Key>ars-full-20261123-101112.arsbak</Key><Size>5</Size></Contents><Contents><Key>notes.txt</Key><Size>1</Size></Contents>")).toEqual([{ key: "ars-full-20261123-101112.arsbak", size: 5, modified: "" }]);
  });
});
