// D-408 (v1.81.0, BK-1): making, checking and restoring a backup package in
// resumable steps. Each step does as much as fits in its time budget and
// returns a small state (no secrets: positions, counts, names) that the next
// step continues from, so long work survives request time limits and process
// restarts (GoDaddy/Passenger). The app drives these from Super Admin →
// Backup, restore & migrate and from the job runner; restore.js and
// restore-on-start.js run them to the end in one go.
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { PackageWriter, PackageReader, PackageError, fileSha256 } = require("./arsbak");
const db = require("./arsbak-db");

const FILE_PIECE = 16 << 20; // files are stored in pieces of 16 MiB
const SECRET_ENV = [
  "APP_BASE_URL",
  "LEGACY_HOSTS",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_POOL_SIZE",
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "BACKUP_ENCRYPTION_KEY",
  "JOB_RUNNER_SECRET",
  "HEALTH_SECRET",
  "ORIGIN_SECRET",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "UPLOAD_DIR",
  "BACKUP_DIR",
  "BACKUP_KEEP_DAYS",
  "AI_CLAUDE_BASE_URL",
  "PUSH_EXTRA_ENDPOINT_ORIGINS",
];
const MODES = ["full", "database", "files", "tables"];
const hasDb = (mode) => mode === "full" || mode === "database" || mode === "tables";
const hasFiles = (mode) => mode === "full" || mode === "files";
const pad = (n) => String(n).padStart(5, "0");
const now = () => Date.now();

// ---------- files ----------

// Every file under the upload folder, relative, with "/" separators. Hidden
// work folders of a restore (.restore-*) are skipped.
async function listFiles(root) {
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (!rel && entry.name.startsWith(".restore-")) continue;
      const full = path.join(dir, entry.name);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, relative);
      else if (entry.isFile()) out.push(relative);
    }
  }
  await walk(root, "");
  return out;
}

// A path from a package, made safe: relative, no "..", no drive letters.
function safeRelative(relative) {
  const clean = String(relative).replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new PackageError("DAMAGED", `The package names a file outside the upload folder (${clean.slice(0, 80)}).`);
  }
  return clean;
}

function secretsFromEnv(env) {
  const values = {};
  for (const name of SECRET_ENV) if (env[name] !== undefined && env[name] !== "") values[name] = String(env[name]);
  return values;
}

// ---------- build ----------

// ctx: { file (the .part path), secret ({passphrase}|{serverKey}) on the first
//        step or key (Buffer) after, connect: () => connection, uploadDir,
//        include: {database, files, secrets}, head: {...extra summary}, env }
async function buildStep(ctx, state, budgetMs = 20_000) {
  const started = now();
  const over = (limit = budgetMs) => now() - started > limit;
  let writer;
  let connection = null;
  try {
    if (!state || !state.phase) {
      const include = ctx.include;
      connection = include.database ? await ctx.connect() : null;
      const tables = connection ? await db.listTables(connection) : [];
      const migrations = connection ? await db.appliedMigrations(connection) : [];
      const files = include.files ? await listFiles(ctx.uploadDir) : [];
      await fsp.writeFile(`${ctx.file}.files.json`, JSON.stringify(files));
      await fsp.writeFile(`${ctx.file}.hashes.jsonl`, "");
      writer = await PackageWriter.create(ctx.file, ctx.secret);
      const head = {
        format: 1,
        ...ctx.head,
        createdAt: new Date().toISOString(),
        includes: include,
        migrations,
        tables: tables.map((table) => ({ name: table.name, estimate: table.estimate })),
        fileCount: files.length,
      };
      await writer.add("head.json", head);
      if (include.secrets) await writer.add("secrets.json", { env: secretsFromEnv(ctx.env || process.env) });
      state = {
        phase: include.database ? "tables" : include.files ? "files" : "finish",
        writer: await writer.checkpoint(),
        tables: tables.map((table) => table.name),
        tableIndex: 0,
        cursor: null,
        page: 0,
        counts: {},
        fileIndex: 0,
        fileTotal: files.length,
        fileBytes: 0,
        consistent: false,
        progress: { done: 0, total: tables.length + files.length + 1 },
      };
      return { state, key: writer.key, done: false };
    }
    writer = await PackageWriter.resume(ctx.file, ctx.key, state.writer);
    state = { ...state };

    if (state.phase === "tables") {
      connection = await ctx.connect();
      // The whole database in one consistent snapshot when it fits in one
      // step (up to 60 s); a bigger one carries on table by table.
      const snapshot = state.tableIndex === 0 && !state.cursor;
      if (snapshot) {
        await connection.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      }
      const limit = Math.max(budgetMs, 60_000);
      while (state.tableIndex < state.tables.length) {
        const name = state.tables[state.tableIndex];
        const info = await db.tableInfo(connection, name);
        if (!state.cursor) {
          await writer.add(`db/${name}/schema.sql`, info.createSql, { table: name, kind: "schema" });
          state.counts[name] = 0;
          state.page = 0;
        }
        let cursor = state.cursor;
        for (;;) {
          const page = await db.dumpPage(connection, info, cursor);
          for (const statement of page.statements) {
            state.page += 1;
            await writer.add(`db/${name}/${pad(state.page)}.sql`, statement, { table: name, kind: "rows" });
          }
          state.counts[name] += page.rows;
          cursor = page.next;
          if (page.done) break;
          if (over(limit)) break;
        }
        if (cursor) {
          state.cursor = cursor;
          state.writer = await writer.checkpoint();
          return { state, done: false };
        }
        state.cursor = null;
        state.tableIndex += 1;
        state.progress = { ...state.progress, done: state.progress.done + 1 };
        if (state.tableIndex < state.tables.length && over(limit)) {
          state.writer = await writer.checkpoint();
          return { state, done: false };
        }
      }
      if (snapshot) {
        await connection.query("COMMIT");
        state.consistent = true;
      }
      await writer.add("db/_triggers.json", await db.listTriggers(connection), { kind: "triggers" });
      state.phase = ctx.include.files ? "files" : "finish";
      state.writer = await writer.checkpoint();
      return { state, done: false };
    }

    if (state.phase === "files") {
      const files = JSON.parse(await fsp.readFile(`${ctx.file}.files.json`, "utf8"));
      while (state.fileIndex < files.length) {
        const relative = files[state.fileIndex];
        const full = path.join(ctx.uploadDir, ...relative.split("/"));
        let stat;
        try {
          stat = await fsp.stat(full);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          state.fileIndex += 1; // deleted since the list was made
          continue;
        }
        const parts = Math.max(1, Math.ceil(stat.size / FILE_PIECE));
        const hash = crypto.createHash("sha256");
        const handle = await fsp.open(full, "r");
        let size = 0;
        try {
          for (let part = 0; part < parts; part += 1) {
            const buffer = Buffer.alloc(Math.min(FILE_PIECE, Math.max(0, stat.size - part * FILE_PIECE)));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, part * FILE_PIECE);
            const piece = buffer.subarray(0, bytesRead);
            hash.update(piece);
            size += piece.length;
            await writer.add(`files/${relative}`, piece, { kind: "file", path: relative, part, parts, mtime: stat.mtimeMs });
          }
        } finally {
          await handle.close();
        }
        await fsp.appendFile(`${ctx.file}.hashes.jsonl`, `${JSON.stringify({ p: relative, size, sha256: hash.digest("hex") })}\n`);
        state.fileBytes += size;
        state.fileIndex += 1;
        state.progress = { ...state.progress, done: state.progress.done + 1 };
        if (over()) break;
      }
      if (state.fileIndex >= files.length) state.phase = "finish";
      state.writer = await writer.checkpoint();
      return { state, done: false };
    }

    if (state.phase === "finish") {
      const hashes = (await fsp.readFile(`${ctx.file}.hashes.jsonl`, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const manifest = {
        finishedAt: new Date().toISOString(),
        consistent: state.consistent,
        tables: Object.fromEntries(state.tables.map((name) => [name, { rows: state.counts[name] ?? 0 }])),
        rows: Object.values(state.counts).reduce((sum, value) => sum + value, 0),
        files: hashes,
        fileBytes: state.fileBytes,
      };
      state.writer = await writer.finish(manifest);
      writer = null;
      await fsp.rm(`${ctx.file}.files.json`, { force: true });
      await fsp.rm(`${ctx.file}.hashes.jsonl`, { force: true });
      state.phase = "done";
      state.sha256 = await fileSha256(ctx.file);
      state.size = (await fsp.stat(ctx.file)).size;
      state.progress = { ...state.progress, done: state.progress.total };
      return { state, done: true };
    }
    throw new Error(`Unknown build phase ${state.phase}`);
  } catch (error) {
    if (connection) await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (writer) await writer.close();
    if (connection) await connection.end().catch(() => undefined);
  }
}

// Remove what an unfinished build left.
async function discardBuild(file) {
  for (const suffix of ["", ".files.json", ".hashes.jsonl"]) await fsp.rm(`${file}${suffix}`, { force: true });
}

// ---------- check (dry run) ----------

// Reads the whole package without changing anything: every part's checksum,
// the summary and the manifest. state: { position, entries, bytes, counts }.
async function verifyStep(ctx, state, budgetMs = 20_000) {
  const started = now();
  const reader = await PackageReader.open(ctx.file, ctx.key ? { key: ctx.key } : ctx.secret);
  state = state && state.position !== undefined ? { ...state, counts: { ...state.counts } } : { position: null, entries: 0, bytes: 0, counts: {}, head: null, hasSecrets: false, manifest: null };
  try {
    for await (const entry of reader.entries(state.position)) {
      state.entries += 1;
      state.bytes += entry.data.length;
      if (entry.name === "head.json") state.head = JSON.parse(entry.data.toString("utf8"));
      else if (entry.name === "secrets.json") state.hasSecrets = true;
      else if (entry.name === "manifest.json") {
        state.manifest = JSON.parse(entry.data.toString("utf8"));
        state.position = entry.position;
        return { state, done: true, key: reader.key };
      } else if (entry.meta.kind === "file") state.counts.__files = (state.counts.__files ?? 0) + (entry.meta.part === 0 ? 1 : 0);
      state.position = entry.position;
      if (now() - started > budgetMs) return { state, done: false, key: reader.key };
    }
    throw new PackageError("TRUNCATED", "The package has no manifest (it was not finished).");
  } finally {
    await reader.close();
  }
}

// What the check found, in plain terms for the screen and the log.
function summarise(verified, appMigrations) {
  const head = verified.head || {};
  const manifest = verified.manifest || {};
  const theirs = Array.isArray(head.migrations) ? head.migrations : [];
  const ours = new Set(appMigrations || []);
  const newer = theirs.filter((name) => !ours.has(name));
  const missing = [...ours].filter((name) => !theirs.includes(name));
  const tables = Object.entries(manifest.tables || {}).map(([name, value]) => ({ name, rows: Number(value.rows || 0) }));
  return {
    appVersion: head.appVersion ?? null,
    createdAt: head.createdAt ?? null,
    kind: head.kind ?? null,
    source: head.source ?? null,
    includes: head.includes ?? null,
    consistent: Boolean(manifest.consistent),
    tables,
    rows: tables.reduce((sum, table) => sum + table.rows, 0),
    files: Array.isArray(manifest.files) ? manifest.files.length : 0,
    fileBytes: Number(manifest.fileBytes || 0),
    hasSecrets: Boolean(verified.hasSecrets),
    bytes: verified.bytes,
    migrationsBehind: theirs.length ? missing.length : null,
    migrationsAhead: newer.length,
  };
}

// ---------- restore ----------

// ctx: { file, key, connect, uploadDir, mode, tables (for "tables"), runId,
//        targetEncryptionKey (Buffer), afterSwap?: async (connection) => void }
// state phases: load → swap → finalize → done. The live database is only
// touched at "swap" (one atomic rename); before it, failure just drops the
// _rs_ tables and the staged files.
async function restoreStep(ctx, state, budgetMs = 20_000) {
  const started = now();
  const over = () => now() - started > budgetMs;
  if (!MODES.includes(ctx.mode)) throw new Error("Choose what to restore.");
  const staging = path.join(ctx.uploadDir, `.restore-${ctx.runId}`);
  const aside = path.join(ctx.uploadDir, `.restore-${ctx.runId}-old`);
  state = state && state.phase ? JSON.parse(JSON.stringify(state)) : { phase: "load", position: null, loaded: {}, constraints: {}, triggers: [], tablesSeen: [], files: 0, manifest: null, swap: null, filesMoved: [], warnings: [] };
  const wanted = (table) => hasDb(ctx.mode) && (ctx.mode !== "tables" || (ctx.tables || []).includes(table));
  let connection = null;
  const conn = async () => {
    if (!connection) {
      connection = await ctx.connect();
      await db.prepareSession(connection);
    }
    return connection;
  };
  try {
    if (state.phase === "load") {
      const reader = await PackageReader.open(ctx.file, { key: ctx.key });
      let fileHash = null;
      let fileHandle = null;
      try {
        for await (const entry of reader.entries(state.position)) {
          const meta = entry.meta;
          if (entry.name === "manifest.json") {
            state.manifest = JSON.parse(entry.data.toString("utf8"));
            state.position = entry.position;
            // Every restored table must hold exactly the rows the package says.
            const problems = [];
            for (const table of state.tablesSeen.filter(wanted)) {
              const expected = Number(state.manifest.tables?.[table]?.rows ?? -1);
              const got = await db.exactCount(await conn(), db.stageName(table));
              if (expected !== got) problems.push(`${table}: ${got} rows loaded, ${expected} in the package`);
            }
            if (ctx.mode === "tables") for (const table of ctx.tables || []) if (!state.tablesSeen.includes(table)) problems.push(`${table} isn't in the package`);
            if (problems.length) throw new Error(`The loaded data doesn't match the package: ${problems.slice(0, 5).join("; ")}.`);
            state.phase = "swap";
            return { state, done: false };
          }
          if (entry.name === "head.json") {
            state.head = JSON.parse(entry.data.toString("utf8"));
          } else if (meta.kind === "schema") {
            const table = String(meta.table);
            if (!state.tablesSeen.includes(table)) state.tablesSeen.push(table);
            if (wanted(table)) {
              state.constraints[table] = await db.loadSchema(await conn(), table, entry.data.toString("utf8"));
              state.loaded[table] = 0;
            }
          } else if (meta.kind === "rows") {
            const table = String(meta.table);
            if (wanted(table)) await db.loadRows(await conn(), table, entry.data.toString("utf8"));
          } else if (meta.kind === "triggers") {
            if (hasDb(ctx.mode)) state.triggers = JSON.parse(entry.data.toString("utf8"));
          } else if (meta.kind === "file" && hasFiles(ctx.mode)) {
            const relative = safeRelative(meta.path);
            const target = path.join(staging, ...relative.split("/"));
            if (meta.part === 0) {
              await fsp.mkdir(path.dirname(target), { recursive: true });
              fileHandle = await fsp.open(target, "w");
              fileHash = crypto.createHash("sha256");
            }
            if (!fileHandle) throw new PackageError("DAMAGED", `A piece of ${relative} came without its start.`);
            await fileHandle.write(entry.data);
            fileHash.update(entry.data);
            if (meta.part === meta.parts - 1) {
              await fileHandle.close();
              fileHandle = null;
              await fsp.appendFile(`${staging}.hashes.jsonl`, `${JSON.stringify({ p: relative, sha256: fileHash.digest("hex") })}\n`);
              if (meta.mtime) await fsp.utimes(target, new Date(), new Date(Number(meta.mtime))).catch(() => undefined);
              state.files += 1;
            } else {
              continue; // a file's pieces stay in one step
            }
          }
          state.position = entry.position;
          if (over()) return { state, done: false };
        }
        throw new PackageError("TRUNCATED", "The package has no manifest (it was not finished).");
      } finally {
        if (fileHandle) await fileHandle.close().catch(() => undefined);
        await reader.close();
      }
    }

    if (state.phase === "swap") {
      // Files: each restored file's checksum must match the manifest.
      if (hasFiles(ctx.mode)) {
        const expected = new Map((state.manifest.files || []).map((item) => [item.p, item.sha256]));
        const got = (await fsp.readFile(`${staging}.hashes.jsonl`, "utf8").catch(() => ""))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        const bad = got.filter((item) => expected.get(item.p) !== item.sha256);
        if (bad.length) throw new PackageError("DAMAGED", `${bad.length} restored file(s) don't match the manifest (first: ${bad[0].p}).`);
        if (got.length !== expected.size) throw new PackageError("DAMAGED", `${got.length} files were restored, but the manifest lists ${expected.size}.`);
      }
      const tables = state.tablesSeen.filter(wanted);
      if (tables.length) {
        state.swap = await db.swapIn(await conn(), tables, { replaceAll: ctx.mode === "full" || ctx.mode === "database" });
        state.phase = "verify";
        // Exact counts after the switch.
        const problems = [];
        for (const table of tables) {
          const expected = Number(state.manifest.tables?.[table]?.rows ?? -1);
          const got = await db.exactCount(await conn(), table);
          if (expected !== got) problems.push(`${table}: ${got}/${expected}`);
        }
        if (problems.length) throw new Error(`Row counts differ after the switch: ${problems.slice(0, 5).join("; ")}.`);
        if (ctx.sourceEncryptionKey && ctx.targetEncryptionKey) {
          const rekeyed = await db.rekeyEncrypted(await conn(), ctx.sourceEncryptionKey, ctx.targetEncryptionKey, tables);
          state.rekeyed = rekeyed.values;
        }
      }
      if (hasFiles(ctx.mode)) {
        state.phase = "verify";
        await moveStagedFiles(staging, aside, ctx.uploadDir, state.filesMoved);
      }
      state.phase = "finalize";
      return { state, done: false };
    }

    if (state.phase === "finalize") {
      if (state.swap) {
        const c = await conn();
        await db.dropOld(c, state.swap);
        const problems = await db.addConstraints(c, state.constraints, state.swap.external);
        if (problems.length) state.warnings.push(`Some table links couldn't be added again: ${problems.slice(0, 3).join("; ")}`);
        const triggers = await db.applyTriggers(c, state.triggers, state.swap.restored);
        state.triggersCreated = triggers.created;
        if (triggers.skipped.length) state.warnings.push(`${triggers.skipped.length} database trigger(s) weren't added (${triggers.skipped[0]}). The app works without them; see DEPLOYMENT (database/optional).`);
        // Everyone signs in again: the restored sign-ins belong to the backup's time.
        if (state.swap.restored.includes("user_sessions")) await c.query("DELETE FROM user_sessions").catch(() => undefined);
      }
      await fsp.rm(aside, { recursive: true, force: true });
      await fsp.rm(staging, { recursive: true, force: true });
      await fsp.rm(`${staging}.hashes.jsonl`, { force: true });
      state.phase = "done";
      state.filesMoved = [];
      return { state, done: true };
    }
    if (state.phase === "done") return { state, done: true };
    throw new Error(`Unknown restore phase ${state.phase}`);
  } catch (error) {
    // The caller needs the state as it is now (e.g. after the switch) to roll back.
    if (error && typeof error === "object") error.state = state;
    throw error;
  } finally {
    if (connection) {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
      await connection.end().catch(() => undefined);
    }
  }
}

// Staged files go into the upload folder; any file they replace is kept
// aside until the restore finishes (rollback puts it back).
async function moveStagedFiles(staging, aside, uploadDir, moved) {
  for (const relative of await listFiles(staging)) {
    const from = path.join(staging, ...relative.split("/"));
    const to = path.join(uploadDir, ...relative.split("/"));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    let replaced = false;
    if (fs.existsSync(to)) {
      const keep = path.join(aside, ...relative.split("/"));
      await fsp.mkdir(path.dirname(keep), { recursive: true });
      await fsp.rename(to, keep);
      replaced = true;
    }
    moved.push({ p: relative, replaced });
    await fsp.rename(from, to);
  }
  return moved;
}

// Undo a restore that failed before "finalize" finished: the live tables come
// back (a rename), the staged tables and files go, replaced files return.
// Returns false when the old tables are already gone (then the safety
// snapshot is restored instead).
async function rollbackRestore(ctx, state) {
  const staging = path.join(ctx.uploadDir, `.restore-${ctx.runId}`);
  const aside = path.join(ctx.uploadDir, `.restore-${ctx.runId}-old`);
  let connection = null;
  try {
    connection = await ctx.connect();
    if (state && state.swap && (state.phase === "verify" || state.phase === "finalize")) {
      // "verify": switched, old tables kept. "finalize": the old tables may be gone.
      const [rows] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '\\_old\\_%'");
      const oldLeft = Number(rows[0].n);
      if (state.swap.moved.length && oldLeft < state.swap.moved.length) return false;
      await db.rollbackSwap(connection, state.swap);
    } else {
      await db.dropStaging(connection);
    }
    for (const item of (state && state.filesMoved) || []) {
      const live = path.join(ctx.uploadDir, ...item.p.split("/"));
      if (!fs.existsSync(path.join(staging, ...item.p.split("/")))) await fsp.rm(live, { force: true });
      if (item.replaced) await fsp.rename(path.join(aside, ...item.p.split("/")), live).catch(() => undefined);
    }
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.rm(`${staging}.hashes.jsonl`, { force: true });
    await fsp.rm(aside, { recursive: true, force: true });
    return true;
  } finally {
    if (connection) {
      await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
      await connection.end().catch(() => undefined);
    }
  }
}

// The secrets part (server env values of the source). Read on demand only.
async function readSecrets(file, key) {
  const reader = await PackageReader.open(file, { key });
  try {
    for await (const entry of reader.entries()) {
      if (entry.name === "secrets.json") return JSON.parse(entry.data.toString("utf8"));
      if (entry.name !== "head.json") return null; // secrets always come second
    }
    return null;
  } finally {
    await reader.close();
  }
}

// Run a whole restore in one go (restore.js, restore-on-start.js).
async function restoreAll(ctx) {
  let state = null;
  for (;;) {
    let result;
    try {
      result = await restoreStep(ctx, state, 10 * 60_000);
    } catch (error) {
      const rolledBack = await rollbackRestore(ctx, error.state || state).catch(() => false);
      error.rolledBack = rolledBack;
      throw error;
    }
    state = result.state;
    if (result.done) return state;
  }
}

// ---------- the old daily backup format inside a package-aware reader ----------
const isPackageFile = (file) => /\.arsbak$/i.test(file);

module.exports = {
  SECRET_ENV,
  MODES,
  FILE_PIECE,
  listFiles,
  safeRelative,
  secretsFromEnv,
  buildStep,
  discardBuild,
  verifyStep,
  summarise,
  restoreStep,
  rollbackRestore,
  readSecrets,
  restoreAll,
  isPackageFile,
};
