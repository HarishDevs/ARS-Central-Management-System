// D-408 (v1.81.0, BK-1): pure-Node database copy for the backup package
// (no mysqldump/mysql binaries, no SUPER privilege: works on GoDaddy shared
// hosting and on a VPS). Shared by the app, restore.js and restore-on-start.js.
//
// Dump: table by table, rows paged by primary key (OFFSET for a table without
// one), each page one INSERT of at most ~1 MB, exact values (dates as stored,
// big numbers as text, JSON as MySQL's own text, binary as hex).
// Load ("staged swap"): every table is first loaded beside the live one as
// _rs_<name> (without its foreign keys and checks, whose names must be unique),
// row counts are checked, then ONE atomic RENAME TABLE puts the restored
// tables in place and keeps the old ones as _old_<name>. Until the old tables
// are dropped, rollback is a rename back. Then the constraints and triggers
// are added again (triggers are optional: shared hosting refuses them).
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

// Never in a backup and never replaced by a restore: the centre's own state.
const EXCLUDED_TABLES = new Set(["backup_runs", "backup_uploads", "backup_pairings", "ops_restores", "schema_migration_progress"]);
const STAGE = "_rs_";
const OLD = "_old_";
const PAGE_ROWS = 500;
const MAX_INSERT_BYTES = 1 << 20;

const quoteId = (name) => `\`${String(name).replace(/`/g, "``")}\``;

// One SQL literal (the same rules as the daily backup, D-104).
function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return `'${value.toISOString().slice(0, 23).replace("T", " ")}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\0/g, "\\0").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\x1a/g, "\\Z")}'`;
}

// Exact reads: dates as the stored text, BIGINT/DECIMAL as text, JSON as
// MySQL's own text (no float or big-number rounding through JavaScript).
function typeCast(field, next) {
  if (field.type === "JSON") {
    const text = field.string("utf8");
    return text === null ? null : { __rawJson: text };
  }
  return next();
}
function literal(value) {
  if (value && typeof value === "object" && typeof value.__rawJson === "string") return sqlValue(value.__rawJson);
  return sqlValue(value);
}

const CONNECTION_OPTIONS = { multipleStatements: true, timezone: "Z", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, charset: "UTF8MB4_UNICODE_CI", typeCast };

async function openConnection(config) {
  const connection = await mysql.createConnection({ ...config, ...CONNECTION_OPTIONS });
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}

function connectionFromEnv(env = process.env) {
  for (const name of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) if (!env[name]) throw new Error(`Missing required environment variable ${name}`);
  return openConnection({ host: env.DB_HOST, port: Number(env.DB_PORT ?? 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
}

const isWorkTable = (name) => name.startsWith(STAGE) || name.startsWith(OLD);

async function listTables(connection) {
  const [rows] = await connection.query("SELECT table_name AS name, table_rows AS estimate FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name");
  return rows.map((row) => ({ name: String(row.name), estimate: Number(row.estimate ?? 0) })).filter((row) => !EXCLUDED_TABLES.has(row.name) && !isWorkTable(row.name));
}

async function exactCount(connection, table) {
  const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM ${quoteId(table)}`);
  return Number(row.n);
}

async function tableInfo(connection, name) {
  const [create] = await connection.query(`SHOW CREATE TABLE ${quoteId(name)}`);
  const createSql = String(create[0]["Create Table"]);
  // Computed columns can't be inserted (read from the CREATE text, D-104).
  const computed = new Set([...createSql.matchAll(/^\s*`([^`]+)`[^\n]*\bGENERATED ALWAYS AS\b/gm)].map((match) => match[1]));
  const [columns] = await connection.query(`SHOW COLUMNS FROM ${quoteId(name)}`);
  const insertable = columns.filter((column) => !computed.has(String(column.Field)) && !/(VIRTUAL|STORED) GENERATED/i.test(String(column.Extra ?? ""))).map((column) => String(column.Field));
  const keyColumns = columns.filter((column) => column.Key === "PRI").map((column) => String(column.Field));
  return { name, createSql, insertable, keyColumns };
}

// One page of rows → INSERT statements of at most ~1 MB each.
// cursor: null (start) | { after: [...key values] } | { offset: n } (no primary key).
async function dumpPage(connection, info, cursor) {
  const columnList = info.insertable.map(quoteId).join(", ");
  const keys = info.keyColumns;
  let sql;
  let params = [];
  if (keys.length) {
    const where = cursor && cursor.after ? `WHERE (${keys.map(quoteId).join(", ")}) > (${keys.map(() => "?").join(", ")})` : "";
    params = cursor && cursor.after ? cursor.after : [];
    sql = `SELECT ${columnList} FROM ${quoteId(info.name)} ${where} ORDER BY ${keys.map(quoteId).join(", ")} LIMIT ${PAGE_ROWS}`;
  } else {
    const offset = cursor && cursor.offset ? cursor.offset : 0;
    sql = `SELECT ${columnList} FROM ${quoteId(info.name)} ORDER BY ${info.insertable.map(quoteId).join(", ")} LIMIT ${PAGE_ROWS} OFFSET ${offset}`;
  }
  const [rows] = await connection.query(sql, params);
  const statements = [];
  let values = [];
  let bytes = 0;
  const head = `INSERT INTO ${quoteId(info.name)} (${columnList}) VALUES\n`;
  for (const row of rows) {
    const line = `(${info.insertable.map((column) => literal(row[column])).join(", ")})`;
    if (values.length && bytes + line.length > MAX_INSERT_BYTES) {
      statements.push(`${head}${values.join(",\n")};\n`);
      values = [];
      bytes = 0;
    }
    values.push(line);
    bytes += line.length + 2;
  }
  if (values.length) statements.push(`${head}${values.join(",\n")};\n`);
  const done = rows.length < PAGE_ROWS;
  let next = null;
  if (!done) {
    const last = rows[rows.length - 1];
    next = keys.length ? { after: keys.map((column) => (last[column] && last[column].__rawJson !== undefined ? last[column].__rawJson : last[column])) } : { offset: ((cursor && cursor.offset) || 0) + rows.length };
  }
  return { statements, rows: rows.length, done, next };
}

// Triggers without the DEFINER, so they load under any account.
async function listTriggers(connection) {
  const [triggers] = await connection.query("SELECT trigger_name AS name, event_object_table AS tbl FROM information_schema.triggers WHERE trigger_schema = DATABASE() ORDER BY trigger_name");
  const out = [];
  for (const trigger of triggers) {
    if (EXCLUDED_TABLES.has(String(trigger.tbl)) || isWorkTable(String(trigger.tbl))) continue;
    const [shown] = await connection.query(`SHOW CREATE TRIGGER ${quoteId(String(trigger.name))}`);
    const statement = String(shown[0]["SQL Original Statement"]).replace(/^CREATE\s+DEFINER\s*=\s*\S+\s+TRIGGER/i, "CREATE TRIGGER");
    out.push({ name: String(trigger.name), table: String(trigger.tbl), sql: statement });
  }
  return out;
}

async function appliedMigrations(connection) {
  try {
    const [rows] = await connection.query("SELECT filename FROM schema_migrations ORDER BY filename");
    return rows.map((row) => String(row.filename));
  } catch {
    return [];
  }
}

// CREATE TABLE text → the same without FOREIGN KEY / CHECK constraints (their
// names are unique per database, so they can't exist twice while the old
// table is kept) and the constraints as ALTER clauses to add afterwards.
function splitConstraints(createSql) {
  const lines = createSql.split("\n");
  const open = lines.findIndex((line) => /^CREATE TABLE/i.test(line));
  const close = lines.findIndex((line, index) => index > open && /^\)/.test(line));
  if (open === -1 || close === -1) return { sql: createSql, constraints: [] };
  const body = lines.slice(open + 1, close).map((line) => line.replace(/,\s*$/, ""));
  const constraints = [];
  const kept = [];
  for (const line of body) {
    if (/^\s*CONSTRAINT\s+`[^`]+`\s+(FOREIGN KEY|CHECK)\b/i.test(line)) constraints.push(line.trim());
    else kept.push(line);
  }
  const sql = [...lines.slice(0, open + 1), kept.join(",\n"), ...lines.slice(close)].join("\n");
  return { sql, constraints };
}

function renameCreate(createSql, from, to) {
  const head = `CREATE TABLE ${quoteId(from)}`;
  if (!createSql.startsWith(head)) throw new Error(`Unexpected CREATE TABLE for ${from}.`);
  return `CREATE TABLE ${quoteId(to)}${createSql.slice(head.length)}`;
}

function renameInsert(sql, from, to) {
  const head = `INSERT INTO ${quoteId(from)} `;
  if (!sql.startsWith(head)) throw new Error(`Unexpected statement in the data of ${from}.`);
  return `INSERT INTO ${quoteId(to)} ${sql.slice(head.length)}`;
}

const stageName = (table) => `${STAGE}${table}`.slice(0, 64);
const oldName = (table) => `${OLD}${table}`.slice(0, 64);

async function prepareSession(connection) {
  await connection.query("SET NAMES utf8mb4");
  await connection.query("SET time_zone = '+00:00'");
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  await connection.query("SET UNIQUE_CHECKS = 0");
}

async function loadSchema(connection, table, createSql) {
  await connection.query(`DROP TABLE IF EXISTS ${quoteId(stageName(table))}`);
  const { sql, constraints } = splitConstraints(createSql);
  await connection.query(renameCreate(sql, table, stageName(table)));
  return constraints;
}

async function loadRows(connection, table, sql) {
  const statement = renameInsert(sql.replace(/;\s*$/, ""), table, stageName(table));
  await connection.query(statement);
}

async function dropStaging(connection) {
  const [rows] = await connection.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '\\_rs\\_%'");
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const row of rows) await connection.query(`DROP TABLE IF EXISTS ${quoteId(String(row.name))}`);
  return rows.length;
}

async function liveForeignKeys(connection) {
  const [rows] = await connection.query(
    `SELECT rc.constraint_name AS name, rc.table_name AS tbl, rc.referenced_table_name AS ref
       FROM information_schema.referential_constraints rc
      WHERE rc.constraint_schema = DATABASE()`,
  );
  return rows.map((row) => ({ name: String(row.name), table: String(row.tbl), ref: String(row.ref) }));
}

async function constraintClause(connection, table, name) {
  const info = await tableInfo(connection, table);
  const line = splitConstraints(info.createSql).constraints.find((clause) => clause.startsWith(`CONSTRAINT ${quoteId(name)} `));
  return line || null;
}

// The atomic switch. tables: the restored tables (each has a _rs_ copy).
// replaceAll: also move aside live tables the package doesn't have (full and
// database restores give exactly the backup; migrations then add newer tables).
async function swapIn(connection, tables, { replaceAll }) {
  const live = new Set((await listTables(connection)).map((row) => row.name));
  const restored = new Set(tables);
  const moved = [...live].filter((name) => restored.has(name) || replaceAll);
  const movedSet = new Set(moved);
  // Foreign keys on tables that stay, pointing at a table that moves: they
  // would follow the old table, so they are dropped and added again after.
  const external = [];
  for (const fk of await liveForeignKeys(connection)) {
    if (!movedSet.has(fk.table) && movedSet.has(fk.ref)) {
      const clause = await constraintClause(connection, fk.table, fk.name);
      if (clause) external.push({ table: fk.table, name: fk.name, clause });
    }
  }
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const fk of external) await connection.query(`ALTER TABLE ${quoteId(fk.table)} DROP FOREIGN KEY ${quoteId(fk.name)}`);
  for (const name of moved) await connection.query(`DROP TABLE IF EXISTS ${quoteId(oldName(name))}`);
  const pairs = [...moved.map((name) => `${quoteId(name)} TO ${quoteId(oldName(name))}`), ...tables.map((name) => `${quoteId(stageName(name))} TO ${quoteId(name)}`)];
  try {
    if (pairs.length) await connection.query(`RENAME TABLE ${pairs.join(", ")}`);
  } catch (error) {
    for (const fk of external) await connection.query(`ALTER TABLE ${quoteId(fk.table)} ADD ${fk.clause}`).catch(() => undefined);
    throw error;
  }
  return { moved, restored: tables, external };
}

// Undo swapIn while the old tables still exist.
async function rollbackSwap(connection, swap) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  const pairs = [...swap.restored.map((name) => `${quoteId(name)} TO ${quoteId(stageName(name))}`), ...swap.moved.map((name) => `${quoteId(oldName(name))} TO ${quoteId(name)}`)];
  for (const name of swap.restored) await connection.query(`DROP TABLE IF EXISTS ${quoteId(stageName(name))}`);
  if (pairs.length) await connection.query(`RENAME TABLE ${pairs.join(", ")}`);
  for (const fk of swap.external) await connection.query(`ALTER TABLE ${quoteId(fk.table)} ADD ${fk.clause}`).catch(() => undefined);
  await dropStaging(connection);
}

async function dropOld(connection, swap) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const name of swap.moved) await connection.query(`DROP TABLE IF EXISTS ${quoteId(oldName(name))}`);
}

// Constraints of the restored tables, then the external keys dropped by swapIn.
async function addConstraints(connection, constraintsByTable, external) {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  const problems = [];
  for (const [table, clauses] of Object.entries(constraintsByTable)) {
    for (const clause of clauses) {
      try {
        await connection.query(`ALTER TABLE ${quoteId(table)} ADD ${clause}`);
      } catch (error) {
        if (error && error.code === "ER_FK_DUP_NAME") continue;
        problems.push(`${table}: ${error.code || error.message}`);
      }
    }
  }
  for (const fk of external || []) {
    try {
      await connection.query(`ALTER TABLE ${quoteId(fk.table)} ADD ${fk.clause}`);
    } catch (error) {
      problems.push(`${fk.table}: ${error.code || error.message}`);
    }
  }
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  return problems;
}

const PRIVILEGE_ERRORS = new Set(["ER_SPECIFIC_ACCESS_DENIED_ERROR", "ER_TABLEACCESS_DENIED_ERROR", "ER_DBACCESS_DENIED_ERROR", "ER_BINLOG_CREATE_ROUTINE_NEED_SUPER", "ER_ACCESS_DENIED_ERROR", "ER_TRG_NO_DEFINER"]);

// Triggers for the restored tables. Shared hosting refuses them (D-370): that
// is a warning, exactly like the migrations' optional triggers.
async function applyTriggers(connection, triggers, tables) {
  const wanted = new Set(tables);
  let created = 0;
  const skipped = [];
  for (const trigger of triggers) {
    if (!wanted.has(trigger.table)) continue;
    try {
      await connection.query(`DROP TRIGGER IF EXISTS ${quoteId(trigger.name)}`);
      await connection.query(trigger.sql);
      created += 1;
    } catch (error) {
      skipped.push(`${trigger.name}: ${PRIVILEGE_ERRORS.has(error.code) || /SUPER|TRIGGER command denied/i.test(String(error.message)) ? "not allowed for this database user" : error.code || error.message}`);
    }
  }
  return { created, skipped };
}

// ENCRYPTION_KEY format (lib/security/encryption.ts): base64(iv | tag | ciphertext).
function tryDecrypt(encoded, key) {
  if (typeof encoded !== "string" || encoded.length < 40 || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) return null;
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 29) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}
function encryptWith(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

// Re-keys every value encrypted with the source's ENCRYPTION_KEY to this
// server's key: columns named *_enc, settings values, and sealed message
// payloads ({"sealed": …}). A value is only changed when it really decrypts
// with the source key (AES-GCM proves it), so plain values are never touched.
async function rekeyEncrypted(connection, fromKey, toKey, tables = null) {
  if (!fromKey || !toKey || fromKey.equals(toKey)) return { values: 0 };
  const only = tables ? new Set(tables) : null;
  const [columns] = await connection.query(
    `SELECT table_name AS tbl, column_name AS col, data_type AS type FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND (column_name LIKE '%\\_enc' OR (table_name IN ('system_settings', 'settings_change_history') AND data_type IN ('text', 'mediumtext', 'varchar', 'longtext')) OR (column_name = 'payload_json' AND data_type = 'json'))`,
  );
  let values = 0;
  for (const column of columns) {
    const table = String(column.tbl);
    const name = String(column.col);
    if (EXCLUDED_TABLES.has(table) || isWorkTable(table) || (only && !only.has(table))) continue;
    const info = await tableInfo(connection, table);
    if (!info.keyColumns.length) continue;
    const json = String(column.type).toLowerCase() === "json";
    const where = json ? `JSON_TYPE(JSON_EXTRACT(${quoteId(name)}, '$.sealed')) = 'STRING'` : `${quoteId(name)} IS NOT NULL`;
    let after = null;
    for (;;) {
      const keyList = info.keyColumns.map(quoteId).join(", ");
      const [rows] = await connection.query(
        `SELECT ${keyList}, ${quoteId(name)} AS v FROM ${quoteId(table)} WHERE ${where}${after ? ` AND (${keyList}) > (${info.keyColumns.map(() => "?").join(", ")})` : ""} ORDER BY ${keyList} LIMIT 500`,
        after || [],
      );
      for (const row of rows) {
        const raw = row.v && row.v.__rawJson !== undefined ? row.v.__rawJson : row.v;
        let updated = null;
        if (json) {
          const parsed = JSON.parse(String(raw));
          const plain = tryDecrypt(parsed.sealed, fromKey);
          if (plain) updated = JSON.stringify({ ...parsed, sealed: encryptWith(plain, toKey) });
        } else {
          const plain = tryDecrypt(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw), fromKey);
          if (plain) updated = encryptWith(plain, toKey);
        }
        if (updated !== null) {
          await connection.query(`UPDATE ${quoteId(table)} SET ${quoteId(name)} = ? WHERE ${info.keyColumns.map((key) => `${quoteId(key)} = ?`).join(" AND ")}`, [updated, ...info.keyColumns.map((key) => row[key])]);
          values += 1;
        }
      }
      if (rows.length < 500) break;
      const last = rows[rows.length - 1];
      after = info.keyColumns.map((key) => last[key]);
    }
  }
  return { values };
}

module.exports = {
  EXCLUDED_TABLES,
  STAGE,
  OLD,
  PAGE_ROWS,
  quoteId,
  sqlValue,
  openConnection,
  connectionFromEnv,
  listTables,
  exactCount,
  tableInfo,
  dumpPage,
  listTriggers,
  appliedMigrations,
  splitConstraints,
  renameCreate,
  renameInsert,
  stageName,
  oldName,
  prepareSession,
  loadSchema,
  loadRows,
  dropStaging,
  swapIn,
  rollbackSwap,
  dropOld,
  addConstraints,
  applyTriggers,
  rekeyEncrypted,
  tryDecrypt,
  encryptWith,
};
