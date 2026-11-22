import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as engine from "@/scripts/database/arsbak-engine";
import * as arsdb from "@/scripts/database/arsbak-db";

// D-408 (v1.81.0, BK-1): dump → package → restore round trip against real
// MySQL. Every table comes back exactly (CHECKSUM TABLE), awkward values
// included (BLOB, JSON with big numbers, utf8mb4, NULL, dates to the
// microsecond, unsigned BIGINT, a table without a primary key over one page),
// attachments come back byte for byte (one over a 16 MiB piece), encrypted
// settings are re-keyed, and a failure after the switch rolls back.
const host = process.env.TEST_DB_HOST ?? "127.0.0.1";
const port = Number(process.env.TEST_DB_PORT ?? 3307);
const user = process.env.TEST_DB_USER ?? "ars_dev";
const password = process.env.TEST_DB_PASSWORD ?? "ars_dev_password";
const rootPassword = process.env.TEST_DB_ROOT_PASSWORD ?? "ars_root_password";
const sourceDb = process.env.DB_NAME ?? "ars_approvals_test";
const targetDb = `${sourceDb}_target`.slice(0, 64);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ars-bk-int-"));
const sourceUploads = path.join(work, "src-uploads");
const targetUploads = path.join(work, "dst-uploads");
const KEY_A = crypto.randomBytes(32);
const KEY_B = crypto.randomBytes(32);
const PASS = { passphrase: "integration test passphrase" };

const root = () => mysql.createConnection({ host, port, user: "root", password: rootPassword });
const connectTo = (database: string) => () => arsdb.openConnection({ host, port, user, password, database });

async function checksums(database: string, skip: string[] = []) {
  const connection = await mysql.createConnection({ host, port, user, password, database });
  try {
    const [tables] = await connection.query<mysql.RowDataPacket[]>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name");
    const out: Record<string, string> = {};
    for (const row of tables) {
      const name = String(row.name);
      if (arsdb.EXCLUDED_TABLES.has(name) || skip.includes(name)) continue;
      const [[sum]] = await connection.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE \`${name}\``);
      out[name] = String(sum!.Checksum);
    }
    return out;
  } finally {
    await connection.end();
  }
}

async function build(file: string, include = { database: true, files: true, secrets: true }) {
  let state: engine.BuildState | null = null;
  let key: Buffer | undefined;
  for (let steps = 0; steps < 500; steps += 1) {
    // A tiny budget forces many resumable steps.
    const result: { state: engine.BuildState; done: boolean; key?: Buffer } = await engine.buildStep(
      { file, secret: state ? undefined : PASS, key, connect: connectTo(sourceDb), uploadDir: sourceUploads, include, head: { appVersion: "test", kind: "full" }, env: { ENCRYPTION_KEY: KEY_A.toString("base64"), DB_NAME: sourceDb } },
      state,
      1,
    );
    key ??= result.key;
    state = result.state;
    if (result.done) return { state, key: key! };
  }
  throw new Error("build did not finish");
}

beforeAll(async () => {
  const connection = await root();
  await connection.query(`DROP DATABASE IF EXISTS \`${targetDb}\``);
  await connection.query(`CREATE DATABASE \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`GRANT ALL PRIVILEGES ON \`${targetDb}\`.* TO ?@'%'`, [user]);
  await connection.end();

  const source = await mysql.createConnection({ host, port, user, password, database: sourceDb, multipleStatements: true });
  await source.query(`
    DROP TABLE IF EXISTS zz_bk_child; DROP TABLE IF EXISTS zz_bk_types; DROP TABLE IF EXISTS zz_bk_nokey;
    CREATE TABLE zz_bk_types (
      id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      blob_col LONGBLOB NULL, json_col JSON NULL, text_col TEXT CHARACTER SET utf8mb4 NULL,
      d DATE NULL, dt DATETIME(6) NULL, ts TIMESTAMP(3) NULL, t TIME(2) NULL, dec_col DECIMAL(30,10) NULL,
      f FLOAT NULL, dbl DOUBLE NULL, b BIT(8) NULL, e ENUM('a','b') NULL,
      twice BIGINT GENERATED ALWAYS AS ((id % 1000) * 2) VIRTUAL,
      CONSTRAINT chk_zz_bk_dec CHECK (dec_col IS NULL OR dec_col > -1000000)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE zz_bk_child (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, type_id BIGINT UNSIGNED NOT NULL,
      CONSTRAINT fk_zz_bk_child_type FOREIGN KEY (type_id) REFERENCES zz_bk_types (id) ON DELETE CASCADE) ENGINE=InnoDB;
    CREATE TABLE zz_bk_nokey (n INT NOT NULL, label VARCHAR(20) NULL) ENGINE=InnoDB;
  `);
  await source.query(
    "INSERT INTO zz_bk_types (id, blob_col, json_col, text_col, d, dt, ts, t, dec_col, f, dbl, b, e) VALUES (18446744073709551615, ?, ?, ?, '2026-11-23', '2026-11-23 10:11:12.123456', '2026-11-23 04:05:06.789', '-12:34:56.78', '12345678901234567890.0123456789', 0.1, 0.30000000000000004, b'10100101', 'b'), (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL), (3, '', '{\"a\":[1,2.50,{\"b\":null}],\"emoji\":\"✅\"}', '', '1000-01-01', '9999-12-31 23:59:59.999999', '1970-01-01 00:00:01.000', '838:59:59', '-999999.5', -1.5, 1e300, b'0', 'a')",
    [Buffer.from([0, 1, 2, 255, 0x27, 0x5c, 0x0a, 0x1a]), '{"big": 1234567890123456789, "one": 1.0, "quote": "it\'s \\\\ fine"}', "O'Brien \\ Śrī ✓ 😀 \"quotes\"\nnew line\r\0end"],
  );
  await source.query("INSERT INTO zz_bk_child (type_id) VALUES (2), (3)");
  const rows = Array.from({ length: 1234 }, (_, n) => [n % 7, n % 3 ? `row ${n}` : null]);
  await source.query("INSERT INTO zz_bk_nokey (n, label) VALUES ?", [rows]);
  // An encrypted setting (as lib/security/encryption.ts stores it) with key A.
  await source.query(
    "INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('backup.s3_secret_access_key', 'BACKUP', 'STRING', TRUE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [arsdb.encryptWith(Buffer.from("s3-secret-value"), KEY_A)],
  );
  await source.end();

  fs.mkdirSync(path.join(sourceUploads, "2026", "11"), { recursive: true });
  fs.writeFileSync(path.join(sourceUploads, "2026", "11", "quote.pdf"), "%PDF-1.4 drill");
  fs.writeFileSync(path.join(sourceUploads, "2026", "11", "big.bin"), crypto.randomBytes(engine.FILE_PIECE + 1234));
  fs.writeFileSync(path.join(sourceUploads, "empty.txt"), "");
  fs.mkdirSync(path.join(targetUploads, "2026", "11"), { recursive: true });
  fs.writeFileSync(path.join(targetUploads, "2026", "11", "quote.pdf"), "an older copy");
  fs.writeFileSync(path.join(targetUploads, "kept.txt"), "a file only the target has");
});

afterAll(async () => {
  const source = await mysql.createConnection({ host, port, user, password, database: sourceDb, multipleStatements: true });
  await source.query("DROP TABLE IF EXISTS zz_bk_child; DROP TABLE IF EXISTS zz_bk_types; DROP TABLE IF EXISTS zz_bk_nokey; DELETE FROM system_settings WHERE setting_key = 'backup.s3_secret_access_key'");
  await source.end();
  const connection = await root();
  await connection.query(`DROP DATABASE IF EXISTS \`${targetDb}\``);
  await connection.end();
  fs.rmSync(work, { recursive: true, force: true });
});

describe("backup package round trip (D-408)", { timeout: 180_000 }, () => {
  let file: string;
  let key: Buffer;

  it("builds a full package in many small resumable steps", async () => {
    file = path.join(work, "full.arsbak");
    const built = await build(file);
    key = built.key;
    expect(built.state.phase).toBe("done");
    expect(built.state.counts.zz_bk_nokey).toBe(1234);
    expect(built.state.counts.zz_bk_types).toBe(3);
    expect(built.state.fileTotal).toBe(3);
    expect(built.state.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Nothing of the secrets is readable in the file.
    expect(fs.readFileSync(file).includes(Buffer.from(KEY_A.toString("base64")))).toBe(false);
    expect(fs.existsSync(`${file}.files.json`)).toBe(false);
  });

  it("checks the package without changing anything (dry run)", async () => {
    let state: engine.VerifyState | null = null;
    for (;;) {
      const result = await engine.verifyStep({ file, key }, state, 1);
      state = result.state;
      if (result.done) break;
    }
    const summary = engine.summarise(state!, []);
    expect(summary.hasSecrets).toBe(true);
    expect(summary.files).toBe(3);
    expect(summary.tables.find((table) => table.name === "zz_bk_nokey")?.rows).toBe(1234);
    expect(summary.tables.some((table) => arsdb.EXCLUDED_TABLES.has(table.name))).toBe(false);
    expect((await engine.readSecrets(file, key))?.env.ENCRYPTION_KEY).toBe(KEY_A.toString("base64"));
  });

  it("restores everything exactly into another database, re-keying encrypted values", async () => {
    // The target has its own older data and a table the package doesn't have.
    const target = await mysql.createConnection({ host, port, user, password, database: targetDb, multipleStatements: true });
    await target.query("CREATE TABLE only_here (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO only_here VALUES (1); CREATE TABLE zz_bk_types (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO zz_bk_types VALUES (99)");
    await target.end();

    const ctx: engine.RestoreContext = { file, key, connect: connectTo(targetDb), uploadDir: targetUploads, mode: "full", runId: "t1", sourceEncryptionKey: KEY_A, targetEncryptionKey: KEY_B };
    let state: engine.RestoreState | null = null;
    for (let steps = 0; steps < 2000; steps += 1) {
      const result = await engine.restoreStep(ctx, state, 200);
      state = result.state;
      if (result.done) break;
    }
    expect(state!.phase).toBe("done");
    expect(state!.rekeyed).toBe(1);

    const a = await checksums(sourceDb, ["system_settings"]);
    const b = await checksums(targetDb, ["system_settings"]);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort()); // only_here is gone, nothing extra
    const differences = Object.keys(a).filter((name) => a[name] !== b[name]);
    expect(differences).toEqual([]);

    const check = await mysql.createConnection({ host, port, user, password, database: targetDb });
    try {
      const [[setting]] = await check.query<mysql.RowDataPacket[]>("SELECT value FROM system_settings WHERE setting_key = 'backup.s3_secret_access_key'");
      expect(arsdb.tryDecrypt(String(setting!.value), KEY_B)?.toString()).toBe("s3-secret-value");
      expect(arsdb.tryDecrypt(String(setting!.value), KEY_A)).toBeNull();
      const [[{ n: settingsCount }]] = (await check.query("SELECT COUNT(*) AS n FROM system_settings")) as unknown as [[{ n: number }]];
      const [[{ n: sourceSettings }]] = (await (await mysql.createConnection({ host, port, user, password, database: sourceDb })).query("SELECT COUNT(*) AS n FROM system_settings")) as unknown as [[{ n: number }]];
      expect(Number(settingsCount)).toBe(Number(sourceSettings));
      // Exact awkward values.
      const [[row]] = await check.query<mysql.RowDataPacket[]>("SELECT HEX(blob_col) AS blob_hex, CAST(json_col AS CHAR) AS j, text_col, CAST(dt AS CHAR) AS dt, CAST(dec_col AS CHAR) AS dec_col, CAST(id AS CHAR) AS id, twice IS NULL AS no_twice FROM zz_bk_types WHERE id = 18446744073709551615");
      expect(row!.blob_hex).toBe("000102FF275C0A1A");
      expect(row!.j).toContain("1234567890123456789");
      expect(row!.text_col).toBe("O'Brien \\ Śrī ✓ 😀 \"quotes\"\nnew line\r\0end");
      expect(row!.dt).toBe("2026-11-23 10:11:12.123456");
      expect(row!.dec_col).toBe("12345678901234567890.0123456789");
      // Constraints came back (the foreign key cascades, the check refuses).
      const [fks] = await check.query<mysql.RowDataPacket[]>("SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_name IN ('fk_zz_bk_child_type', 'chk_zz_bk_dec')");
      expect(fks.map((fk) => fk.name).sort()).toEqual(["chk_zz_bk_dec", "fk_zz_bk_child_type"]);
      // No work tables left behind.
      const [work] = await check.query<mysql.RowDataPacket[]>("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND (table_name LIKE '\\_rs\\_%' OR table_name LIKE '\\_old\\_%')");
      expect(work).toEqual([]);
      // Triggers came back (Docker's ars_dev may create them).
      const [[triggers]] = await check.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE()");
      expect(Number(triggers!.n)).toBe(state!.triggersCreated);
    } finally {
      await check.end();
    }
    // Files: byte for byte; a file only the target had stays; no work folders.
    for (const relative of ["2026/11/quote.pdf", "2026/11/big.bin", "empty.txt"]) {
      expect(fs.readFileSync(path.join(targetUploads, relative)).equals(fs.readFileSync(path.join(sourceUploads, relative)))).toBe(true);
    }
    expect(fs.readFileSync(path.join(targetUploads, "kept.txt"), "utf8")).toBe("a file only the target has");
    expect(fs.readdirSync(targetUploads).filter((name) => name.startsWith(".restore-"))).toEqual([]);
  });

  it("restores chosen tables only, keeping links from other tables", async () => {
    const target = await mysql.createConnection({ host, port, user, password, database: targetDb });
    await target.query("DELETE FROM zz_bk_child");
    await target.query("DELETE FROM zz_bk_types WHERE id = 2");
    await target.end();
    const ctx: engine.RestoreContext = { file, key, connect: connectTo(targetDb), uploadDir: targetUploads, mode: "tables", tables: ["zz_bk_types"], runId: "t2" };
    await engine.restoreAll(ctx);
    const check = await mysql.createConnection({ host, port, user, password, database: targetDb });
    try {
      const [[types]] = await check.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM zz_bk_types");
      const [[children]] = await check.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM zz_bk_child");
      expect(Number(types!.n)).toBe(3);
      expect(Number(children!.n)).toBe(0); // not chosen, so untouched
      const [[fk]] = await check.query<mysql.RowDataPacket[]>("SELECT referenced_table_name AS ref FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND constraint_name = 'fk_zz_bk_child_type'");
      expect(fk!.ref).toBe("zz_bk_types"); // the link points at the restored table
    } finally {
      await check.end();
    }
  });

  it("rolls back to the live tables when the switch finds a mismatch", async () => {
    const before = await checksums(targetDb);
    const ctx: engine.RestoreContext = { file, key, connect: connectTo(targetDb), uploadDir: targetUploads, mode: "database", runId: "t3" };
    let state: engine.RestoreState | null = null;
    for (;;) {
      const result = await engine.restoreStep(ctx, state, 60_000);
      state = result.state;
      if (state.phase === "swap") break;
    }
    // Something changes a staged table between the load and the switch.
    const target = await mysql.createConnection({ host, port, user, password, database: targetDb });
    await target.query("DELETE FROM `_rs_zz_bk_nokey` LIMIT 1");
    await target.end();
    const error = await engine.restoreStep(ctx, state, 60_000).then(() => null, (caught: Error & { state?: engine.RestoreState }) => caught);
    expect(error?.message).toMatch(/Row counts differ/);
    expect(error?.state?.phase).toBe("verify");
    expect(await engine.rollbackRestore(ctx, error!.state!)).toBe(true);
    expect(await checksums(targetDb)).toEqual(before);
  });

  it("restore-on-start reads the package once, with the same guards (D-403)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { main } = require("../../scripts/database/restore-on-start.js") as { main: (env: Record<string, string | undefined>) => Promise<{ status: string }> };
    const saved = process.env.DB_NAME;
    process.env.DB_NAME = targetDb;
    try {
      const env = { ...process.env, DB_NAME: targetDb, DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, RESTORE_CONFIRM: targetDb, RESTORE_FILE: file, UPLOAD_DIR: targetUploads, ENCRYPTION_KEY: KEY_A.toString("base64") };
      expect((await main({ ...env, RESTORE_PASSPHRASE: "wrong wrong wrong wrong" })).status).toBe("unreadable");
      // The target already has requests: refused without RESTORE_FORCE.
      const target = await mysql.createConnection({ host, port, user, password, database: targetDb });
      const [[requests]] = await target.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM approval_requests");
      await target.end();
      if (Number(requests!.n) > 0) expect((await main({ ...env, RESTORE_PASSPHRASE: PASS.passphrase })).status).toBe("refused");
      expect((await main({ ...env, RESTORE_PASSPHRASE: PASS.passphrase, RESTORE_FORCE: targetDb, RESTORE_MODE: "database" })).status).toBe("restored");
      expect((await main({ ...env, RESTORE_PASSPHRASE: PASS.passphrase, RESTORE_FORCE: targetDb })).status).toBe("already");
      const a = await checksums(sourceDb, ["system_settings"]);
      const b = await checksums(targetDb, ["system_settings"]);
      expect(Object.keys(a).filter((name) => a[name] !== b[name])).toEqual([]);
    } finally {
      process.env.DB_NAME = saved;
    }
  });

  it("refuses a wrong passphrase and a missing chosen table before touching anything", async () => {
    await expect(engine.verifyStep({ file, secret: { passphrase: "not the right passphrase" } }, null)).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    const before = await checksums(targetDb);
    const ctx: engine.RestoreContext = { file, key, connect: connectTo(targetDb), uploadDir: targetUploads, mode: "tables", tables: ["no_such_table"], runId: "t4" };
    await expect(engine.restoreAll(ctx)).rejects.toThrow(/isn't in the package/);
    expect(await checksums(targetDb)).toEqual(before);
  });
});
