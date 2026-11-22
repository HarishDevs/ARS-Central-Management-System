#!/usr/bin/env node
// D-403 (22 Nov 2026): one-time restore of a bundled, encrypted backup when the
// app starts. Runs in `npm start` BEFORE migrate.js. It does nothing unless the
// owner sets BOTH GoDaddy secrets:
//   RESTORE_CONFIRM     = the database name (DB_NAME), to confirm the replace
//   RESTORE_BACKUP_KEY  = the 32-byte base64 key the bundle was encrypted with
// Optional: RESTORE_FILE (default: the bundle in database/restore/),
//           RESTORE_FORCE = DB_NAME to replace a database that already has requests.
// D-408 (v1.81.0): RESTORE_FILE may also be a backup package (.arsbak) made in
// Super Admin → Backup, restore & migrate. Then set RESTORE_PASSPHRASE (the
// package's passphrase; for a scheduled package or safety snapshot,
// RESTORE_BACKUP_KEY = the BACKUP_ENCRYPTION_KEY it was made with) and,
// optionally, RESTORE_MODE = full (default: database, attachments into
// UPLOAD_DIR, encrypted settings re-keyed) | database | files. The package is
// loaded beside the live tables and switched in at once (the same reader and
// engine as the app).
// Safety:
//   - The backup's .sha256 is checked and the file is AES-256-GCM decrypted
//     (a package checks every part as it is read).
//   - It refuses to touch a database that already holds approval requests
//     (unless RESTORE_FORCE), so a live database is never overwritten by mistake.
//   - A marker row (table ops_restores, not part of any backup) records the
//     file's hash, so the same file is restored once only, even though preview
//     and published apps share the database and both run npm start.
//   - GET_LOCK stops the two apps restoring at the same time.
//   - The old .sql.gz.enc format: every existing table is dropped first, so the
//     migrations that run next find exactly the backup's schema plus its
//     schema_migrations rows. A package: the live tables stay until the switch.
//   - Any failure never blocks start-up: (old format) the tables are cleared
//     and migrate.js rebuilds an empty schema; (package) the live tables are
//     switched back. The log says what went wrong.
// Remove the secrets after the restore (the marker makes it harmless if left).
const path = require("node:path");
const fs = require("node:fs");
const { connect } = require("./env");
const { readBackup } = require("./backup-file");
const { splitDump } = require("./restore");
const { PackageReader, fileSha256, keyFromText } = require("./arsbak");
const engine = require("./arsbak-engine");
const db = require("./arsbak-db");

const DEFAULT_FILE = path.join(__dirname, "..", "..", "database", "restore", "ars-db-20261122-152503.sql.gz.enc");

function log(message) {
  console.log(`[restore-on-start] ${message}`);
}

async function dropAllTables(connection) {
  const [rows] = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> 'ops_restores'",
  );
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const row of rows) await connection.query(`DROP TABLE IF EXISTS \`${String(row.name).replace(/`/g, "``")}\``);
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  return rows.length;
}

async function tableHasRows(connection, table) {
  const [exists] = await connection.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table],
  );
  if (!Number(exists[0].n)) return false;
  const [rows] = await connection.query(`SELECT 1 FROM \`${table}\` LIMIT 1`);
  return rows.length > 0;
}

// D-408: a .arsbak package, through the shared engine.
async function restorePackage(file, env) {
  let secret = null;
  const { header } = await PackageReader.readHeader(file);
  if (header.kdf.alg === "server-key") {
    const key = keyFromText(env.RESTORE_BACKUP_KEY || "") || keyFromText(env.BACKUP_ENCRYPTION_KEY || "");
    if (key) secret = { serverKey: key };
  } else if (env.RESTORE_PASSPHRASE) {
    secret = { passphrase: env.RESTORE_PASSPHRASE };
  }
  if (!secret) {
    log(header.kdf.alg === "server-key" ? "the package needs RESTORE_BACKUP_KEY (the BACKUP_ENCRYPTION_KEY it was made with); nothing restored." : "the package needs RESTORE_PASSPHRASE; nothing restored.");
    return { status: "unreadable" };
  }
  let key;
  try {
    const reader = await PackageReader.open(file, secret);
    key = reader.key;
    await reader.close();
  } catch (error) {
    log(`can't open the package: ${error.message}`);
    return { status: "unreadable" };
  }
  const mode = ["full", "database", "files"].includes(env.RESTORE_MODE) ? env.RESTORE_MODE : "full";
  const secrets = mode === "files" ? null : await engine.readSecrets(file, key).catch(() => null);
  const source = secrets && secrets.env && secrets.env.ENCRYPTION_KEY ? Buffer.from(secrets.env.ENCRYPTION_KEY, "base64") : null;
  const target = Buffer.from(env.ENCRYPTION_KEY || "", "base64");
  const ctx = {
    file,
    key,
    connect: () => db.connectionFromEnv(env),
    uploadDir: path.resolve(env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads")),
    mode,
    runId: "start",
    sourceEncryptionKey: source && source.length === 32 ? source : null,
    targetEncryptionKey: target.length === 32 ? target : null,
  };
  const started = Date.now();
  try {
    const state = await engine.restoreAll(ctx);
    log(`restored ${path.basename(file)} (${mode}): ${state.swap ? state.swap.restored.length : 0} tables, ${state.files} attachments, ${state.rekeyed || 0} values re-keyed, in ${Math.round((Date.now() - started) / 1000)} s.${state.warnings.length ? ` Note: ${state.warnings.join(" ")}` : ""}`);
    return { status: "restored", statements: state.swap ? state.swap.restored.length : 0 };
  } catch (error) {
    log(`restore failed (${error.code || error.message}); ${error.rolledBack ? "the live data was kept (switched back)" : "check the database"}.`);
    return { status: "failed", error: error.message };
  }
}

async function main(env = process.env) {
  const confirm = env.RESTORE_CONFIRM;
  if (!confirm) return { status: "skipped" };
  if (confirm !== env.DB_NAME) {
    log(`RESTORE_CONFIRM does not match DB_NAME; nothing restored.`);
    return { status: "mismatch" };
  }
  const file = env.RESTORE_FILE || DEFAULT_FILE;
  if (!fs.existsSync(file)) {
    log(`backup file not found (${path.basename(file)}); nothing restored.`);
    return { status: "missing" };
  }
  const isPackage = engine.isPackageFile(file);
  const fileHash = await fileSha256(file);
  const connection = await connect();
  let locked = false;
  try {
    const [lock] = await connection.query("SELECT GET_LOCK('ars_restore_on_start', 900) AS got");
    locked = Number(lock[0].got) === 1;
    if (!locked) {
      log("another app is restoring; skipped.");
      return { status: "busy" };
    }
    await connection.query(
      "CREATE TABLE IF NOT EXISTS ops_restores (file_sha256 CHAR(64) NOT NULL PRIMARY KEY, file_name VARCHAR(200) NOT NULL, statements INT UNSIGNED NOT NULL, restored_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
    );
    const [done] = await connection.query("SELECT restored_at FROM ops_restores WHERE file_sha256 = ?", [fileHash]);
    if (done.length) {
      log(`${path.basename(file)} was already restored; skipped. You can remove RESTORE_CONFIRM and ${isPackage ? "RESTORE_PASSPHRASE" : "RESTORE_BACKUP_KEY"}.`);
      return { status: "already" };
    }
    if ((await tableHasRows(connection, "approval_requests")) && env.RESTORE_FORCE !== env.DB_NAME) {
      log("the database already has approval requests; refusing to replace it (set RESTORE_FORCE to the database name to override).");
      return { status: "refused" };
    }
    if (isPackage) {
      const result = await restorePackage(file, env);
      if (result.status === "restored") {
        await connection.query("INSERT INTO ops_restores (file_sha256, file_name, statements) VALUES (?, ?, ?)", [fileHash, path.basename(file), result.statements]);
      }
      return result;
    }
    let sql;
    try {
      sql = readBackup(file, env.RESTORE_BACKUP_KEY ? Buffer.from(env.RESTORE_BACKUP_KEY, "base64") : null);
    } catch (error) {
      log(`can't read the backup: ${error.message}`);
      return { status: "unreadable" };
    }
    const statements = splitDump(sql);
    const started = Date.now();
    const dropped = await dropAllTables(connection);
    log(`replacing ${dropped} tables with ${path.basename(file)} (${statements.length} statements)…`);
    try {
      for (const statement of statements) await connection.query(statement);
    } catch (error) {
      log(`restore failed (${error.code || error.message}); clearing the half-restored tables so the app rebuilds an empty schema.`);
      await dropAllTables(connection);
      return { status: "failed", error: error.message };
    }
    await connection.query("INSERT INTO ops_restores (file_sha256, file_name, statements) VALUES (?, ?, ?)", [
      fileHash,
      path.basename(file),
      statements.length,
    ]);
    log(`restored ${statements.length} statements in ${Math.round((Date.now() - started) / 1000)} s.`);
    return { status: "restored", statements: statements.length };
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('ars_restore_on_start')").catch(() => {});
    await connection.end();
  }
}

module.exports = { main, DEFAULT_FILE };

if (require.main === module) {
  // Never block start-up: any unexpected error is logged and start continues.
  main()
    .catch((error) => log(`unexpected error, continuing start-up: ${error.message}`))
    .finally(() => process.exit(0));
}
