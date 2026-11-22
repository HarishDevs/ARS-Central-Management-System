#!/usr/bin/env node
// Restores a backup made by the app (server/ops/backup.ts, D-104) into the
// database named by DB_NAME. Every table in the file is dropped and
// re-created, so you must name the database on the command line to confirm.
// Usage:
//   node scripts/database/restore.js <ars-db-YYYYMMDD-HHMMSS.sql.gz[.enc]> --confirm-database=<DB_NAME>
// An encrypted backup needs BACKUP_ENCRYPTION_KEY (the key it was made with).
// Restore into a NEW, empty database first and check it (DEPLOYMENT Part P).
// D-408 (v1.81.0): a backup package (.arsbak) from Super Admin → Backup,
// restore & migrate works too, read by the same engine as the app:
//   node scripts/database/restore.js <package.arsbak> --confirm-database=<DB_NAME> [--mode=full|database|files]
// The passphrase comes from RESTORE_PASSPHRASE or is asked for (never on the
// command line, where it would stay in the shell history). A scheduled
// package or safety snapshot opens with BACKUP_ENCRYPTION_KEY. Attachments go
// to UPLOAD_DIR; encrypted settings are re-keyed to this ENCRYPTION_KEY.
const fs = require("node:fs");
const { connect } = require("./env");
const { readBackup } = require("./backup-file");

// Statements end with ";" at the end of a line; "DELIMITER $$" blocks
// (triggers) end with "$$". Quotes inside values never end a statement
// because values are on one line and escaped.
function splitDump(sql) {
  const statements = [];
  let delimiter = ";";
  let buffer = [];
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^DELIMITER\s+/i.test(trimmed)) {
      delimiter = trimmed.split(/\s+/)[1];
      continue;
    }
    if (!buffer.length && (trimmed === "" || trimmed.startsWith("--"))) continue;
    buffer.push(line);
    if (trimmed.endsWith(delimiter)) {
      const statement = buffer.join("\n");
      statements.push(statement.slice(0, statement.lastIndexOf(delimiter)));
      buffer = [];
    }
  }
  if (buffer.join("").trim()) statements.push(buffer.join("\n"));
  return statements;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function restorePackage(file) {
  const path = require("node:path");
  const { PackageReader, keyFromText } = require("./arsbak");
  const engine = require("./arsbak-engine");
  const db = require("./arsbak-db");
  const { header } = await PackageReader.readHeader(file);
  let secret;
  if (header.kdf.alg === "server-key") {
    const key = keyFromText(process.env.RESTORE_BACKUP_KEY || process.env.BACKUP_ENCRYPTION_KEY || "") || keyFromText(await ask("BACKUP_ENCRYPTION_KEY the package was made with: "));
    if (!key) throw new Error("That isn't a BACKUP_ENCRYPTION_KEY (base64 of 32 bytes).");
    secret = { serverKey: key };
  } else {
    secret = { passphrase: process.env.RESTORE_PASSPHRASE || (await ask("Passphrase: ")) };
  }
  const reader = await PackageReader.open(file, secret);
  const key = reader.key;
  await reader.close();
  const modeArg = (process.argv.find((arg) => arg.startsWith("--mode=")) || "").split("=")[1];
  const mode = ["full", "database", "files"].includes(modeArg) ? modeArg : "full";
  const secrets = mode === "files" ? null : await engine.readSecrets(file, key);
  const source = secrets && secrets.env && secrets.env.ENCRYPTION_KEY ? Buffer.from(secrets.env.ENCRYPTION_KEY, "base64") : null;
  const target = Buffer.from(process.env.ENCRYPTION_KEY || "", "base64");
  const state = await engine.restoreAll({
    file,
    key,
    connect: () => db.connectionFromEnv(process.env),
    uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads")),
    mode,
    runId: "cli",
    sourceEncryptionKey: source && source.length === 32 ? source : null,
    targetEncryptionKey: target.length === 32 ? target : null,
  });
  console.log(`Restored ${file} into ${process.env.DB_NAME} (${mode}): ${state.swap ? state.swap.restored.length : 0} tables, ${state.files} attachments, ${state.rekeyed || 0} values re-keyed.`);
  for (const warning of state.warnings) console.log(`Note: ${warning}`);
  console.log("Now run: node scripts/database/migrate.js (npm start does it too).");
}

async function main() {
  const file = process.argv[2];
  const confirm = (process.argv.find((arg) => arg.startsWith("--confirm-database=")) || "").split("=")[1];
  if (!file || !fs.existsSync(file)) throw new Error("Give the backup file: node scripts/database/restore.js <file.sql.gz | file.arsbak> --confirm-database=<DB_NAME>");
  if (!confirm || confirm !== process.env.DB_NAME) {
    throw new Error(`This replaces every table in "${process.env.DB_NAME}". Run again with --confirm-database=${process.env.DB_NAME} to confirm.`);
  }
  if (/\.arsbak$/i.test(file)) return restorePackage(file);
  // D-246 (audit OPS-09): the .sha256 is checked, and an encrypted (.enc) file decrypted.
  const sql = readBackup(file);
  const statements = splitDump(sql);
  const connection = await connect();
  try {
    let done = 0;
    for (const statement of statements) {
      await connection.query(statement);
      done += 1;
    }
    console.log(`Restored ${file} into ${process.env.DB_NAME}: ${done} statements.`);
  } finally {
    await connection.end();
  }
}

module.exports = { splitDump };

if (require.main === module) {
  main().catch((error) => {
    console.error("Restore failed:", error.message);
    process.exit(1);
  });
}
