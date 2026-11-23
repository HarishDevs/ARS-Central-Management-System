import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import * as engine from "@/scripts/database/arsbak-engine";
import * as arsdb from "@/scripts/database/arsbak-db";
import { PackageError, PackageReader, passphraseProblem } from "@/scripts/database/arsbak";
import { getEnv } from "@/config/environment";
import { backupEncryptionKey } from "@/server/ops/backup";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { getDbPool } from "@/lib/db/client";
import { logError } from "@/lib/logging/logger";
import { getSettingValue } from "@/server/settings/values";
import { loadDriveSettings } from "@/server/ops/gdrive-backup";
import { DRIVE_PIECE, deleteFile, downloadRange, getAccessToken, listPackageFiles, selectPackagesForDeletion, startResumableUpload, uploadPiece, type DriveDeps } from "@/server/ops/gdrive";
import { cachedKey, forgetKeys, rememberKey } from "@/server/ops/backup-centre/keys";
import { alertBackupEvent } from "@/server/ops/backup-centre/alerts";
import * as runs from "@/server/ops/backup-centre/runs";
import { appMigrations, appVersion, deletePackage, finishPackageFiles, listPackages, newPackageName, packagePath, packagesDir, readMeta, uploadRoot, writeMeta, type PackageKind, type PackageMeta } from "@/server/ops/backup-centre/storage";
import type { PackageRow, RunView } from "@/features/superadmin/backup/types";

// D-408 (v1.81.0, BK-1): the Backup, restore & migrate centre. Every long job
// is a run (backup_runs) moved on in steps of about 20 seconds by the page
// (and the job runner for scheduled work), so nothing depends on one long
// request. Passphrases are never stored: the page keeps the one typed in
// memory and sends it with each step; the derived key is kept in memory for
// an hour (keys.ts). Super Admin only (checked by every route); a restore
// also needs the database's name typed and a finished check of the package.

const run = promisify(execFile);
export const STEP_BUDGET_MS = 20_000;
const MAINTENANCE_TEXT = "ARS is being restored from a backup by the Super Admin. Please wait before making changes: anything saved now may be lost.";

export class CentreError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "CentreError";
  }
}

export interface Actor {
  id: number;
  name: string;
  sessionId?: string | null;
}

function dbConfig() {
  const env = getEnv();
  return { host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME };
}
export const connect = () => arsdb.openConnection(dbConfig());

export function serverKey(): Buffer | null {
  try {
    return backupEncryptionKey();
  } catch {
    return null;
  }
}

export function targetEncryptionKey(): Buffer | null {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  return key.length === 32 ? key : null;
}

export const partialPath = (name: string) => path.join(packagesDir(), `.${name}.part`);

// A plain message for a failure, never a stack or a secret.
export function explain(error: unknown): string {
  if (error instanceof PackageError || error instanceof CentreError) return error.message;
  const err = error as { code?: string; message?: string; sqlMessage?: string };
  if (err?.code === "ENOSPC" || err?.code === "EDQUOT") return "There's no space left in the backup folder. Delete old packages (or free space in cPanel) and try again.";
  if (err?.code === "EACCES" || err?.code === "EPERM") return "The app isn't allowed to write to the backup folder. On GoDaddy set BACKUP_DIR to /private/backups (Secrets), then Publish.";
  if (err?.code?.startsWith?.("ER_")) return `The database refused a step (${err.code}${err.sqlMessage ? `: ${String(err.sqlMessage).slice(0, 160)}` : ""}).`;
  return String(err?.message ?? "The step failed.").slice(0, 300);
}

// ---------- views ----------

export function toView(item: runs.BackupRun): RunView {
  return {
    id: item.id,
    kind: item.kind,
    trigger: item.trigger,
    status: item.status,
    phase: item.phase,
    mode: item.mode,
    packageName: item.packageName,
    keyKind: item.keyKind,
    progress: { done: item.progressDone, total: item.progressTotal },
    message: item.message,
    error: item.error,
    summary: item.summary,
    options: item.options,
    createdAt: item.createdAt.toISOString(),
    finishedAt: item.finishedAt ? item.finishedAt.toISOString() : null,
  };
}

// ---------- starting runs ----------

export async function audit(actor: Actor | null, action: string, entityId: string | null, metadata: Record<string, unknown>) {
  // After a restore the actor's user id may belong to someone else in the
  // restored data, so later entries carry the name only.
  await recordAudit({ actorUserId: actor && !metadata.afterRestore ? actor.id : null, action, entityType: "BACKUP", entityId: entityId ? entityId.slice(0, 64) : null, sessionId: actor && !metadata.afterRestore ? (actor.sessionId ?? undefined) : undefined, metadata: { ...metadata, by: actor?.name ?? "system" } }).catch((error) => logError("backup audit failed", error));
}

export async function startBackup(input: { include: "full" | "database"; keepOnServer: boolean; copyToDrive: boolean; passphrase: string }, actor: Actor): Promise<{ id: number; token: string }> {
  const problem = passphraseProblem(input.passphrase);
  if (problem) throw new CentreError(problem);
  if (input.copyToDrive) await loadDriveSettings().catch((error) => {
    throw new CentreError(`Google Drive isn't set up: ${explain(error)} (Super Admin → Providers & security → Google Drive backup).`);
  });
  const name = newPackageName(input.include === "full" ? "full" : "database");
  await fsp.mkdir(packagesDir(), { recursive: true });
  const created = await runs.createRun({ kind: "BACKUP", trigger: "MANUAL", phase: "build", mode: input.include, packageName: name, keyKind: "PASSPHRASE", options: { keepOnServer: input.keepOnServer, copyToDrive: input.copyToDrive }, createdBy: actor.id });
  await audit(actor, "BACKUP_PACKAGE_STARTED", name, { include: input.include, keepOnServer: input.keepOnServer, copyToDrive: input.copyToDrive });
  return { id: created.id, token: created.token! };
}

export async function startVerify(input: { name: string; passphrase: string }, actor: Actor): Promise<{ id: number; token: string }> {
  const file = packagePath(input.name);
  if (!file || !fs.existsSync(file)) throw new CentreError("That package isn't on the server any more.", 404, "NOT_FOUND");
  const { header } = await PackageReader.readHeader(file);
  const keyKind = header.kdf.alg === "server-key" ? "SERVER_KEY" : "PASSPHRASE";
  // The passphrase is checked straight away (one scrypt), so a typo shows at once.
  const secret = keyKind === "SERVER_KEY" && !input.passphrase ? (serverKey() ? { serverKey: serverKey()! } : null) : { passphrase: input.passphrase };
  if (!secret) throw new CentreError("This package was made with the server's BACKUP_ENCRYPTION_KEY, which isn't set here. Type that key as the passphrase.");
  const reader = await PackageReader.open(file, secret);
  const key = reader.key;
  await reader.close();
  const stat = await fsp.stat(file);
  const created = await runs.createRun({ kind: "VERIFY", trigger: "MANUAL", phase: "check", packageName: input.name, keyKind, options: { size: stat.size, mtime: stat.mtimeMs }, createdBy: actor.id });
  rememberKey(created.id, "package", key);
  return { id: created.id, token: created.token! };
}

// v1.85.1 (D-413): the package file is the one that was checked: same size and
// the same modified time to the millisecond. The time went through the run's
// JSON column, and MySQL keeps a double to fewer digits than the file system's
// sub-millisecond time (…926.7817 came back as …926.7815), so an exact
// comparison refused an untouched package now and then.
export function samePackageFile(stat: { size: number; mtimeMs: number }, checked: Record<string, unknown>): boolean {
  return stat.size === Number(checked.size) && Math.abs(stat.mtimeMs - Number(checked.mtime)) < 1;
}

export async function startRestore(
  input: { verifyRunId: number; mode: engine.RestoreMode; tables: string[]; confirm: string; acceptWarnings: boolean },
  actor: Actor,
): Promise<{ id: number; token: string }> {
  if (input.confirm.trim() !== getEnv().DB_NAME) throw new CentreError(`Type the database's name (${getEnv().DB_NAME}) exactly to confirm.`);
  if (!engine.MODES.includes(input.mode)) throw new CentreError("Choose what to restore.");
  const verified = await runs.getRun(input.verifyRunId);
  if (!verified || verified.kind !== "VERIFY" || verified.status !== "DONE" || !verified.packageName || !verified.summary) throw new CentreError("Check the package first (Check package), then restore.");
  const file = packagePath(verified.packageName);
  const stat = file ? await fsp.stat(file).catch(() => null) : null;
  if (!file || !stat || !samePackageFile(stat, verified.options)) throw new CentreError("The package changed or was removed since it was checked. Check it again.");
  const summary = verified.summary as unknown as engine.PackageSummary & { warnings?: string[] };
  const includes = summary.includes ?? { database: true, files: false, secrets: false };
  if ((input.mode === "full" || input.mode === "database" || input.mode === "tables") && !includes.database) throw new CentreError("This package has no database. Choose Files only.");
  if ((input.mode === "full" || input.mode === "files") && !includes.files) throw new CentreError("This package has no attachments. Choose Database only (or chosen tables).");
  const known = new Set(summary.tables.map((table) => table.name));
  const tables = input.mode === "tables" ? [...new Set(input.tables)].filter((table) => known.has(table)) : [];
  if (input.mode === "tables" && !tables.length) throw new CentreError("Tick at least one table to restore.");
  if ((summary.warnings ?? []).length && !input.acceptWarnings) throw new CentreError("Read the warnings from the check and tick that you understand them.");
  const cached = cachedKey(verified.id, "package");
  let created: { id: number; token: string | null };
  try {
    created = await runs.createRun({ kind: "RESTORE", trigger: "MANUAL", phase: "snapshot", mode: input.mode, packageName: verified.packageName, keyKind: verified.keyKind, options: { tables, verifyRunId: verified.id, size: stat.size, mtime: stat.mtimeMs, summary: { appVersion: summary.appVersion, createdAt: summary.createdAt, hasSecrets: summary.hasSecrets } }, parentRunId: verified.id, createdBy: actor.id, activeSlot: "RESTORE" });
  } catch (error) {
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new CentreError("Another restore is running. Wait for it to finish (see Recent activity).", 409, "BUSY");
    throw error;
  }
  if (cached) rememberKey(created.id, "package", cached);
  // Maintenance notice for everyone while it runs (D-233's banner).
  const previous = await getSettingValue("general.maintenance_notice").catch(() => null);
  await setMaintenanceNotice(MAINTENANCE_TEXT);
  await runs.saveStep(created.id, { phase: "snapshot", state: { previousNotice: previous ?? "", snapshot: null, restore: null, rollback: null }, progressDone: 0, progressTotal: 100, message: "Making a safety snapshot of the system as it is now…", keepLease: false });
  await audit(actor, "BACKUP_RESTORE_STARTED", verified.packageName, { mode: input.mode, tables: tables.length ? tables : undefined });
  await alertBackupEvent("RESTORE_STARTED", `Restoring ${verified.packageName} (${modeLabel(input.mode)}). The app shows a maintenance notice until it finishes.`, actor.name);
  return { id: created.id, token: created.token! };
}

export function modeLabel(mode: string | null): string {
  return mode === "full" ? "everything: database, attachments and secrets" : mode === "database" ? "database only" : mode === "files" ? "attachments only" : mode === "tables" ? "chosen tables" : "";
}

async function setMaintenanceNotice(value: string): Promise<void> {
  await getDbPool().query(
    "INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('general.maintenance_notice', 'GENERAL', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
    [value],
  );
}

async function clearMaintenanceNotice(previous: string | null): Promise<void> {
  const current = await getSettingValue("general.maintenance_notice").catch(() => null);
  if (current === MAINTENANCE_TEXT) await setMaintenanceNotice(previous ?? "").catch(() => undefined);
}

export async function startDriveCopy(name: string, actor: Actor | null, trigger: runs.RunTrigger = "MANUAL"): Promise<{ id: number; token: string | null }> {
  const file = packagePath(name);
  if (!file || !fs.existsSync(file)) throw new CentreError("That package isn't on the server any more.", 404, "NOT_FOUND");
  await loadDriveSettings().catch((error) => {
    throw new CentreError(`Google Drive isn't set up: ${explain(error)}`);
  });
  const created = await runs.createRun({ kind: "DRIVE_COPY", trigger, phase: "upload", packageName: name, options: {}, createdBy: actor?.id ?? null, withToken: Boolean(actor) });
  await runs.saveStep(created.id, { phase: "upload", state: { location: null, offset: 0 }, progressDone: 0, progressTotal: 100, message: "Copying to Google Drive…" });
  if (actor) await audit(actor, "BACKUP_PACKAGE_TO_DRIVE", name, {});
  return created;
}

export async function listDrivePackages(): Promise<{ id: string; name: string; size: number; createdTime: string }[]> {
  const config = await loadDriveSettings().catch((error) => {
    throw new CentreError(`Google Drive isn't set up: ${explain(error)}`);
  });
  const token = await getAccessToken(config.key, driveDeps());
  return listPackageFiles(token, config.folderId, driveDeps());
}

export async function startDriveFetch(input: { fileId: string; name: string; size: number }, actor: Actor): Promise<{ id: number; token: string }> {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(input.fileId)) throw new CentreError("Pick a package from the Drive list.");
  const name = newPackageName("drive", input.fileId.slice(-6));
  const created = await runs.createRun({ kind: "DRIVE_FETCH", trigger: "MANUAL", phase: "download", packageName: name, options: { fileId: input.fileId, driveName: input.name.slice(0, 200), size: input.size }, createdBy: actor.id });
  await runs.saveStep(created.id, { phase: "download", state: { offset: 0 }, progressDone: 0, progressTotal: 100, message: "Copying from Google Drive to the server…" });
  await audit(actor, "BACKUP_PACKAGE_FROM_DRIVE", name, { driveName: input.name.slice(0, 200) });
  return { id: created.id, token: created.token! };
}

const driveDeps = (): DriveDeps => ({ fetch });

// ---------- steps ----------

export interface StepInput {
  passphrase?: string | null;
  // v1.82.0 (D-409): a pairing code or a target database password, kept by the page like the passphrase.
  secret?: string | null;
}

// One step of a run. Returns the run as it is after the step. Safe to call
// from two places at once: only the holder of the lease works.
export async function stepRun(id: number, input: StepInput, actor: Actor | null, budgetMs = STEP_BUDGET_MS): Promise<RunView> {
  const before = await runs.getRun(id);
  if (!before) throw new CentreError("Not found.", 404, "NOT_FOUND");
  if (before.status !== "RUNNING") return toView(before);
  if (!(await runs.claimStep(id))) return toView(before); // another step is working on it
  try {
    switch (before.kind) {
      case "BACKUP":
        await backupStep(before, input, actor, budgetMs);
        break;
      case "VERIFY":
        await verifyStep(before, input, budgetMs);
        break;
      case "RESTORE":
        await restoreStep(before, input, actor, budgetMs);
        break;
      case "DRIVE_COPY":
        await driveCopyStep(before, budgetMs);
        break;
      case "DRIVE_FETCH":
        await driveFetchStep(before, actor, budgetMs);
        break;
      default: {
        // v1.82.0 (D-409): moves between servers, S3, links, the database copy, the check after a move.
        const moves = await import("@/server/ops/backup-centre/moves");
        await moves.moveStep(before, input, actor, budgetMs);
      }
    }
  } catch (error) {
    if (error instanceof CentreError && (error.code === "PASSPHRASE_NEEDED" || error.code === "SECRET_NEEDED")) {
      await runs.releaseLease(id);
      throw error;
    }
    logError("backup centre step failed", error, { runId: id, kind: before.kind, phase: before.phase });
    await runs.releaseLease(id).catch(() => undefined);
    await failRun(before, error, actor).catch((inner) => logError("backup centre failure handling failed", inner, { runId: id }));
  }
  const after = await runs.getRun(id);
  return toView(after!);
}

function needPassphrase(): never {
  throw new CentreError("Type the passphrase again to carry on (it is never stored, so it is needed after the page is reloaded or the server restarted).", 400, "PASSPHRASE_NEEDED");
}

async function keyFor(item: runs.BackupRun, slot: "package" | "snapshot", file: string, input: StepInput): Promise<Buffer> {
  const hit = cachedKey(item.id, slot);
  if (hit) return hit;
  const { header } = await PackageReader.readHeader(file);
  let secret: { passphrase: string } | { serverKey: Buffer } | null = null;
  if (header.kdf.alg === "server-key" && serverKey() && (!input.passphrase || slot === "snapshot")) secret = { serverKey: serverKey()! };
  else if (input.passphrase) secret = { passphrase: input.passphrase };
  if (!secret) needPassphrase();
  const reader = await PackageReader.open(file, secret);
  const key = reader.key;
  await reader.close();
  rememberKey(item.id, slot, key);
  return key;
}

function buildHead(kind: string, actor: Actor | null) {
  return { appVersion: appVersion(), kind, source: { url: process.env.APP_BASE_URL ?? null, database: getEnv().DB_NAME }, createdBy: actor?.name ?? "system" };
}

// One build step for any package being made (manual, scheduled, safety snapshot).
async function buildPackageStep(
  runId: number,
  slot: "package" | "snapshot",
  name: string,
  state: engine.BuildState | null,
  secret: { passphrase: string } | { serverKey: Buffer } | null,
  include: { database: boolean; files: boolean; secrets: boolean },
  kind: string,
  actor: Actor | null,
  budgetMs: number,
): Promise<engine.BuildState> {
  const file = partialPath(name);
  if (!state) {
    if (!secret) needPassphrase();
    await fsp.mkdir(packagesDir(), { recursive: true });
    const result = await engine.buildStep({ file, secret, connect, uploadDir: uploadRoot(), include, head: buildHead(kind, actor) }, null, budgetMs);
    rememberKey(runId, slot, result.key!);
    return result.state;
  }
  let key = cachedKey(runId, slot);
  if (!key) {
    // The first frame holds the summary, so the key can be derived again.
    if (!secret) needPassphrase();
    const reader = await PackageReader.open(file, secret);
    key = reader.key;
    await reader.close();
    rememberKey(runId, slot, key);
  }
  const result = await engine.buildStep({ file, key, connect, uploadDir: uploadRoot(), include, head: {} }, state, budgetMs);
  return result.state;
}

async function backupStep(item: runs.BackupRun, input: StepInput, actor: Actor | null, budgetMs: number) {
  const name = item.packageName!;
  const serverMade = item.keyKind === "SERVER_KEY";
  const secret = serverMade ? (serverKey() ? { serverKey: serverKey()! } : null) : input.passphrase ? { passphrase: input.passphrase } : null;
  if (item.phase === "build") {
    const include = { database: true, files: item.mode === "full", secrets: item.mode === "full" };
    const state = await buildPackageStep(item.id, "package", name, (item.state as engine.BuildState | null) ?? null, secret, include, item.trigger === "SCHEDULED" ? "scheduled" : item.mode ?? "full", actor, budgetMs);
    if (state.phase !== "done") {
      await runs.saveStep(item.id, { phase: "build", state, progressDone: state.progress.done, progressTotal: state.progress.total, message: buildMessage(state) });
      return;
    }
    const meta: PackageMeta = {
      kind: (item.trigger === "SCHEDULED" ? "scheduled" : item.mode) as PackageKind,
      keyKind: serverMade ? "SERVER_KEY" : "PASSPHRASE",
      appVersion: appVersion(),
      includes: include,
      tables: state.tables.length,
      rows: Object.values(state.counts).reduce((sum, value) => sum + value, 0),
      files: state.fileTotal,
      checked: false,
      createdByName: actor?.name ?? (item.trigger === "SCHEDULED" ? "Schedule" : null),
      deleteAfterDownload: item.options.keepOnServer === false && !item.options.copyToDrive,
    };
    await finishPackageFiles(partialPath(name), name, state.sha256!, meta);
    const summary = { tables: meta.tables, rows: meta.rows, files: meta.files, bytes: state.size, consistent: state.consistent };
    await audit(actor, "BACKUP_PACKAGE_CREATED", name, { ...summary, trigger: item.trigger });
    const drive = Boolean(item.options.copyToDrive);
    if (drive) {
      await runs.saveStep(item.id, { phase: "drive", state: { location: null, offset: 0 }, progressDone: 0, progressTotal: 100, message: "Made. Copying to Google Drive…", summary });
      return;
    }
    forgetKeys(item.id);
    await runs.finishRun(item.id, "DONE", { phase: "done", message: doneMessage(summary), summary });
    return;
  }
  if (item.phase === "drive") {
    const done = await driveUpload(item, budgetMs);
    if (done) {
      forgetKeys(item.id);
      if (item.trigger === "SCHEDULED") await pruneDrive().catch((error) => logError("drive package prune failed", error));
      if (item.options.keepOnServer === false) await deletePackage(name);
      await runs.finishRun(item.id, "DONE", { phase: "done", message: `${doneMessage(item.summary ?? {})} Copied to Google Drive.${item.options.keepOnServer === false ? " Removed from the server as asked." : ""}` });
    }
  }
}

function buildMessage(state: engine.BuildState): string {
  if (state.phase === "tables") return `Copying the database: table ${Math.min(state.tableIndex + 1, state.tables.length)} of ${state.tables.length}…`;
  if (state.phase === "files") return `Copying attachments: ${state.fileIndex.toLocaleString("en-IN")} of ${state.fileTotal.toLocaleString("en-IN")}…`;
  return "Finishing the package…";
}

function doneMessage(summary: Record<string, unknown>): string {
  return `Package ready: ${Number(summary.tables ?? 0)} tables, ${Number(summary.rows ?? 0).toLocaleString("en-IN")} rows, ${Number(summary.files ?? 0).toLocaleString("en-IN")} attachments.${summary.consistent === false ? " The database was copied in parts (it was too big for one step), so changes made meanwhile may be partly included." : ""}`;
}

async function verifyStep(item: runs.BackupRun, input: StepInput, budgetMs: number) {
  const file = packagePath(item.packageName ?? "");
  if (!file || !fs.existsSync(file)) throw new CentreError("That package isn't on the server any more.");
  const key = await keyFor(item, "package", file, input);
  const result = await engine.verifyStep({ file, key }, (item.state as engine.VerifyState | null) ?? null, budgetMs);
  const stat = await fsp.stat(file);
  if (!result.done) {
    await runs.saveStep(item.id, { phase: "check", state: result.state, progressDone: Math.min(99, Math.floor((result.state.position?.frameOffset ?? 0) / Math.max(1, stat.size) * 100)), progressTotal: 100, message: "Reading every part of the package and checking it…" });
    return;
  }
  const summary = engine.summarise(result.state, appMigrations());
  const warnings: string[] = [];
  if (summary.migrationsAhead > 0) warnings.push(`The package is from a newer version of ARS CMS (${summary.appVersion ?? "unknown"}; this server runs ${appVersion()}). Update this server first, or restored data may not work here.`);
  if (summary.migrationsBehind) warnings.push(`The package is from an older version (${summary.appVersion ?? "unknown"}). After a full or database restore the ${summary.migrationsBehind} newer migration(s) run by themselves. Chosen tables keep their older layout, which can break the app: prefer a database restore.`);
  if (!summary.consistent && summary.includes?.database) warnings.push("The database was copied in parts while the app was in use, so it may hold a change half-made. Fine for most uses; check recent records after restoring.");
  const meta = await readMeta(item.packageName!);
  if (meta) await writeMeta(item.packageName!, { ...meta, checked: true, appVersion: summary.appVersion, includes: summary.includes, tables: summary.tables.length, rows: summary.rows, files: summary.files });
  await runs.finishRun(item.id, "DONE", { phase: "done", message: "The package is complete and every part matches its checksum. Nothing was changed.", summary: { ...summary, warnings } });
}

type RestoreRunState = {
  previousNotice: string;
  snapshotName?: string;
  snapshot: engine.BuildState | null;
  restore: engine.RestoreState | null;
  rollback: { restore: engine.RestoreState | null } | null;
  migrateOutput?: string;
};

function restoreCtx(item: runs.BackupRun, file: string, key: Buffer, extra: Partial<engine.RestoreContext> = {}): engine.RestoreContext {
  return { file, key, connect, uploadDir: uploadRoot(), mode: item.mode as engine.RestoreMode, tables: (item.options.tables as string[]) ?? [], runId: String(item.id), ...extra };
}

async function restoreStep(item: runs.BackupRun, input: StepInput, actor: Actor | null, budgetMs: number) {
  const state = (item.state as RestoreRunState | null) ?? { previousNotice: "", snapshot: null, restore: null, rollback: null };
  const file = packagePath(item.packageName ?? "");
  if (!file || !fs.existsSync(file)) throw new CentreError("The package was removed from the server during the restore.");
  const mode = item.mode as engine.RestoreMode;
  const withDb = mode !== "files";
  const withFiles = mode === "full" || mode === "files";

  if (item.phase === "snapshot") {
    // The safety snapshot: with the server key when there is one (so the
    // job runner can roll back on its own), else with the typed passphrase.
    const name = state.snapshotName ?? newPackageName("safety", String(item.id));
    const useServer = Boolean(serverKey());
    const secret = useServer ? { serverKey: serverKey()! } : input.passphrase ? { passphrase: input.passphrase } : null;
    if (!state.snapshot) await keyFor(item, "package", file, input); // check the restore passphrase before any work
    const snapshot = await buildPackageStep(item.id, "snapshot", name, state.snapshot, secret, { database: withDb, files: withFiles, secrets: true }, "safety", actor, budgetMs);
    const next: RestoreRunState = { ...state, snapshotName: name, snapshot };
    if (snapshot.phase !== "done") {
      await runs.saveStep(item.id, { phase: "snapshot", state: next, progressDone: Math.floor((snapshot.progress.done / Math.max(1, snapshot.progress.total)) * 30), progressTotal: 100, message: `Safety snapshot: ${buildMessage(snapshot).toLowerCase()}` });
      return;
    }
    await finishPackageFiles(partialPath(name), name, snapshot.sha256!, { kind: "safety", keyKind: useServer ? "SERVER_KEY" : "PASSPHRASE", appVersion: appVersion(), includes: { database: withDb, files: withFiles, secrets: true }, tables: snapshot.tables.length, files: snapshot.fileTotal, createdByName: actor?.name ?? null, source: `before restoring ${item.packageName}` });
    await runs.saveStep(item.id, { phase: "load", state: { ...next, snapshot: { ...snapshot, tables: [], counts: {} } }, progressDone: 30, progressTotal: 100, message: `Safety snapshot ${name} made. Loading the backup beside the live data…` });
    return;
  }

  if (item.phase === "migrate") {
    if (withDb) {
      const output = await runMigrations();
      state.migrateOutput = output;
    }
    await clearMaintenanceNotice(state.previousNotice);
    forgetKeys(item.id);
    const restore = state.restore;
    const summary = { mode, rekeyed: restore?.rekeyed ?? 0, triggers: restore?.triggersCreated ?? 0, files: restore?.files ?? 0, tables: restore?.swap?.restored.length ?? 0, warnings: restore?.warnings ?? [], snapshot: state.snapshotName ?? null, migrations: state.migrateOutput ?? null, hasSecrets: Boolean((item.options.summary as { hasSecrets?: boolean } | undefined)?.hasSecrets) };
    await runs.finishRun(item.id, "DONE", { phase: "done", message: restoreDoneMessage(summary), summary });
    await audit(actor, "BACKUP_RESTORED", item.packageName, { ...summary, afterRestore: withDb });
    await alertBackupEvent("RESTORED", `${item.packageName} was restored (${modeLabel(mode)}). Everyone has to sign in again.`, actor?.name ?? null);
    return;
  }

  if (item.phase === "rollback") {
    const snapshotFile = packagePath(state.snapshotName ?? "");
    if (!snapshotFile || !fs.existsSync(snapshotFile)) throw new CentreError("The safety snapshot is missing, so the restore can't be undone automatically.");
    const key = await keyFor(item, "snapshot", snapshotFile, input);
    const ctx = restoreCtx(item, snapshotFile, key, { mode: withDb ? (withFiles ? "full" : "database") : "files", tables: [], runId: `${item.id}rb` });
    const result = await engine.restoreStep(ctx, state.rollback?.restore ?? null, budgetMs);
    const next = { ...state, rollback: { restore: result.state } };
    if (!result.done) {
      await runs.saveStep(item.id, { phase: "rollback", state: next, message: "The restore failed; putting the safety snapshot back…" });
      return;
    }
    if (withDb) await runMigrations().catch((error) => logError("migrations after rollback failed", error));
    await clearMaintenanceNotice(state.previousNotice);
    forgetKeys(item.id);
    await runs.finishRun(item.id, "ROLLED_BACK", { phase: "done", message: `The restore failed, so the system was put back from the safety snapshot ${state.snapshotName}. Nothing from the backup was kept.` });
    await audit(actor, "BACKUP_RESTORE_ROLLED_BACK", item.packageName, { snapshot: state.snapshotName, afterRestore: true });
    await alertBackupEvent("ROLLED_BACK", `Restoring ${item.packageName} failed and the system was put back from the safety snapshot.`, actor?.name ?? null);
    return;
  }

  // load → swap → verify → finalize (the engine's own phases)
  const key = await keyFor(item, "package", file, input);
  let extra: Partial<engine.RestoreContext> = {};
  if (state.restore?.phase === "swap" && withDb) {
    const secrets = await engine.readSecrets(file, key).catch(() => null);
    const source = secrets?.env?.ENCRYPTION_KEY ? Buffer.from(secrets.env.ENCRYPTION_KEY, "base64") : null;
    extra = { sourceEncryptionKey: source && source.length === 32 ? source : null, targetEncryptionKey: targetEncryptionKey() };
  }
  const result = await engine.restoreStep(restoreCtx(item, file, key, extra), state.restore, budgetMs);
  const next = { ...state, restore: result.state };
  const progress = result.state.phase === "load" ? 30 + Math.min(45, Math.floor(((result.state.position?.frameOffset ?? 0) / Math.max(1, Number(item.options.size) || 1)) * 45)) : result.state.phase === "finalize" ? 85 : result.state.phase === "done" ? 92 : 78;
  if (!result.done) {
    await runs.saveStep(item.id, { phase: result.state.phase, state: next, progressDone: progress, progressTotal: 100, message: restoreMessage(result.state) });
    return;
  }
  await runs.saveStep(item.id, { phase: "migrate", state: next, progressDone: 92, progressTotal: 100, message: "Restored. Bringing the database up to this version (migrations)…" });
}

function restoreMessage(state: engine.RestoreState): string {
  if (state.phase === "load") return `Loading the backup beside the live data (${state.tablesSeen.length} tables, ${state.files} attachments so far). The live system is untouched until the switch.`;
  if (state.phase === "swap") return "Loaded and checked. Switching to the restored data…";
  if (state.phase === "finalize") return "Switched. Adding table links and triggers back…";
  return "Restoring…";
}

function restoreDoneMessage(summary: { tables: number; files: number; rekeyed: number; warnings: string[]; snapshot: string | null; migrations?: string | null }): string {
  const parts = [`Restored ${summary.tables} tables and ${summary.files.toLocaleString("en-IN")} attachments.`];
  if (summary.rekeyed) parts.push(`${summary.rekeyed} encrypted setting(s) were re-keyed to this server's ENCRYPTION_KEY.`);
  if (summary.warnings.length) parts.push(summary.warnings.join(" "));
  parts.push("Everyone (you too) has to sign in again.");
  if (summary.snapshot) parts.push(`The safety snapshot ${summary.snapshot} stays in the list until you delete it.`);
  if (summary.migrations && /runs at the next start/.test(summary.migrations)) parts.push(summary.migrations);
  return parts.join(" ");
}

// The same two scripts npm start runs. A migration that fails (exit code)
// is a real failure (the restore is undone). When the host won't start a
// process or it runs too long, the restored data stays: migrate.js carries on
// by itself at the next start (it is resumable), so the run says so.
async function runMigrations(): Promise<string> {
  const scripts = path.join(process.cwd(), "scripts", "database");
  const lines: string[] = [];
  for (const script of ["migrate.js", "seed.js"]) {
    try {
      const { stdout } = await run(process.execPath, [path.join(scripts, script)], { cwd: process.cwd(), env: process.env, timeout: 280_000, maxBuffer: 4 * 1024 * 1024 });
      lines.push(...String(stdout).trim().split(/\r?\n/).slice(-3));
    } catch (error) {
      const failure = error as { code?: unknown; killed?: boolean; stderr?: string };
      if (typeof failure.code === "number" && !failure.killed) throw new CentreError(`${script} failed after the restore: ${String(failure.stderr ?? "").trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300)}`);
      lines.push(`${script} couldn't run here (${String(failure.code ?? "timeout")}); it runs at the next start: publish or restart the app now.`);
    }
  }
  return lines.join(" ").slice(0, 500);
}

// What to do when a step fails.
async function failRun(item: runs.BackupRun, error: unknown, actor: Actor | null): Promise<void> {
  const message = explain(error);
  const fresh = (await runs.getRun(item.id)) ?? item;
  if (fresh.kind === "BACKUP") {
    await engine.discardBuild(partialPath(fresh.packageName ?? "x"));
    forgetKeys(fresh.id);
    await runs.finishRun(fresh.id, "FAILED", { error: message, message: "The backup stopped. Nothing was changed; the half-made package was removed." });
    return;
  }
  if (fresh.kind === "DB_COPY") {
    const moves = await import("@/server/ops/backup-centre/moves");
    await moves.failDbCopy(fresh, error, actor);
    return;
  }
  if (fresh.kind !== "RESTORE") {
    if (["SEND", "PULL", "URL_FETCH", "S3_FETCH"].includes(fresh.kind)) await fsp.rm(partialPath(fresh.packageName ?? "x"), { force: true });
    forgetKeys(fresh.id);
    await runs.finishRun(fresh.id, "FAILED", { error: message });
    return;
  }
  const state = (fresh.state as RestoreRunState | null) ?? { previousNotice: "", snapshot: null, restore: null, rollback: null };
  const errorState = (error as { state?: engine.RestoreState }).state ?? null;
  if (fresh.phase === "snapshot") {
    if (state.snapshotName) await engine.discardBuild(partialPath(state.snapshotName));
    await clearMaintenanceNotice(state.previousNotice);
    forgetKeys(fresh.id);
    await runs.finishRun(fresh.id, "FAILED", { error: message, message: "The safety snapshot couldn't be made, so nothing was restored or changed." });
    await alertBackupEvent("RESTORE_FAILED", `Restoring ${fresh.packageName} stopped before anything was changed: ${message}`, actor?.name ?? null);
    return;
  }
  if (fresh.phase === "rollback") {
    await clearMaintenanceNotice(state.previousNotice);
    forgetKeys(fresh.id);
    await runs.finishRun(fresh.id, "FAILED", { error: message, message: `The restore failed and putting back the safety snapshot failed too. Restore ${state.snapshotName} from the list (mode: everything), or follow DEPLOYMENT Part P.` });
    await alertBackupEvent("RESTORE_FAILED", `Restoring ${fresh.packageName} failed, and so did the automatic undo. Restore the safety snapshot ${state.snapshotName} now.`, actor?.name ?? null);
    return;
  }
  // load / swap / verify / finalize / migrate: undo.
  const engineState = errorState ?? state.restore;
  let undone = false;
  if (fresh.phase !== "migrate" && engineState?.phase !== "done") {
    const file = packagePath(fresh.packageName ?? "") ?? "";
    undone = await engine.rollbackRestore(restoreCtx(fresh, file, Buffer.alloc(32)), engineState).catch(() => false);
  }
  if (undone) {
    await clearMaintenanceNotice(state.previousNotice);
    forgetKeys(fresh.id);
    await runs.finishRun(fresh.id, engineState?.swap ? "ROLLED_BACK" : "FAILED", { error: message, message: engineState?.swap ? "The restore failed after the switch, so the live data was switched straight back. Nothing from the backup was kept." : "The restore stopped while loading. The live system was never touched." });
    await alertBackupEvent(engineState?.swap ? "ROLLED_BACK" : "RESTORE_FAILED", `Restoring ${fresh.packageName} failed (${message}); the system is as it was.`, actor?.name ?? null);
    return;
  }
  // The old tables are gone: restore the safety snapshot.
  await runs.saveStep(fresh.id, { phase: "rollback", state: { ...state, restore: engineState, rollback: { restore: null } }, message: `The restore failed (${message}). Putting the safety snapshot back…` });
  await getDbPool().query("UPDATE backup_runs SET error_text = ? WHERE id = ?", [message.slice(0, 1000), fresh.id]);
}

export async function cancelRun(id: number, actor: Actor): Promise<RunView> {
  const item = await runs.getRun(id);
  if (!item) throw new CentreError("Not found.", 404, "NOT_FOUND");
  if (item.status !== "RUNNING") return toView(item);
  if ((item.kind === "RESTORE" && !["snapshot", "load"].includes(item.phase)) || (item.kind === "DB_COPY" && !["build", "snapshot", "load"].includes(item.phase))) throw new CentreError("The data is being switched now and can't be stopped. It finishes or undoes itself in a moment.", 409, "BUSY");
  if (!(await runs.claimStep(id, 60))) throw new CentreError("A step is running. Try again in a few seconds.", 409, "BUSY");
  await abandon(item);
  await runs.finishRun(id, "CANCELLED", { message: `Stopped by ${actor.name}. Nothing was changed.` });
  await audit(actor, "BACKUP_RUN_CANCELLED", item.packageName, { kind: item.kind, phase: item.phase });
  return toView((await runs.getRun(id))!);
}

// Tidy up after a run stopped before it changed anything.
async function abandon(item: runs.BackupRun): Promise<void> {
  if (item.kind === "BACKUP") await engine.discardBuild(partialPath(item.packageName ?? "x"));
  if (item.kind === "RESTORE") {
    const state = (item.state as RestoreRunState | null) ?? null;
    if (state?.snapshotName && item.phase === "snapshot") await engine.discardBuild(partialPath(state.snapshotName));
    if (item.phase === "load") await engine.rollbackRestore(restoreCtx(item, "", Buffer.alloc(32)), state?.restore ?? null).catch(() => undefined);
    await clearMaintenanceNotice(state?.previousNotice ?? "");
  }
  if (item.kind === "DRIVE_FETCH") await fsp.rm(path.join(packagesDir(), `.${item.packageName}.part`), { force: true });
  if (["SEND", "PULL", "URL_FETCH", "S3_COPY", "S3_FETCH", "DB_COPY", "LIVE_CHECK"].includes(item.kind)) {
    const moves = await import("@/server/ops/backup-centre/moves");
    await moves.abandonMove(item);
  }
  forgetKeys(item.id);
}

// ---------- Google Drive copies ----------

async function driveUpload(item: runs.BackupRun, budgetMs: number): Promise<boolean> {
  const started = Date.now();
  const file = packagePath(item.packageName ?? "");
  if (!file || !fs.existsSync(file)) throw new CentreError("The package isn't on the server any more.");
  const config = await loadDriveSettings();
  const size = (await fsp.stat(file)).size;
  const state = { location: null as string | null, offset: 0, ...((item.state as Record<string, unknown> | null) ?? {}) } as { location: string | null; offset: number };
  if (!state.location) {
    const token = await getAccessToken(config.key, driveDeps());
    state.location = await startResumableUpload(token, config.folderId, item.packageName!, size, driveDeps());
  }
  const handle = await fsp.open(file, "r");
  try {
    while (state.offset < size && Date.now() - started < budgetMs) {
      const piece = Buffer.alloc(Math.min(DRIVE_PIECE, size - state.offset));
      await handle.read(piece, 0, piece.length, state.offset);
      const result = await uploadPiece(state.location, piece, state.offset, size, driveDeps());
      state.offset = result.next;
      if (result.id !== null) state.offset = size;
    }
  } finally {
    await handle.close();
  }
  const done = state.offset >= size;
  await runs.saveStep(item.id, { phase: item.phase, state, progressDone: Math.floor((state.offset / Math.max(1, size)) * 100), progressTotal: 100, message: done ? "Copied to Google Drive." : `Copying to Google Drive: ${Math.floor((state.offset / Math.max(1, size)) * 100)}%…` });
  return done;
}

async function driveCopyStep(item: runs.BackupRun, budgetMs: number) {
  if (await driveUpload(item, budgetMs)) {
    // Scheduled copies: keep only the newest N on Drive.
    if (item.trigger === "SCHEDULED") await pruneDrive().catch((error) => logError("drive package prune failed", error));
    await runs.finishRun(item.id, "DONE", { phase: "done", message: `${item.packageName} copied to Google Drive.` });
  }
}

async function pruneDrive() {
  const config = await loadDriveSettings();
  const token = await getAccessToken(config.key, driveDeps());
  const keep = Number(await getSettingValue("backup.package_keep").catch(() => "7")) || 7;
  for (const old of selectPackagesForDeletion(await listPackageFiles(token, config.folderId, driveDeps()), keep)) await deleteFile(token, old.id, driveDeps());
}

async function driveFetchStep(item: runs.BackupRun, actor: Actor | null, budgetMs: number) {
  const started = Date.now();
  const config = await loadDriveSettings();
  const token = await getAccessToken(config.key, driveDeps());
  const size = Number(item.options.size);
  const partial = path.join(packagesDir(), `.${item.packageName}.part`);
  await fsp.mkdir(packagesDir(), { recursive: true });
  const state = { offset: 0, ...((item.state as Record<string, unknown> | null) ?? {}) } as { offset: number };
  if (state.offset === 0) await fsp.writeFile(partial, Buffer.alloc(0));
  const current = (await fsp.stat(partial).catch(() => null))?.size ?? 0;
  if (current !== state.offset) await fsp.truncate(partial, state.offset);
  while (state.offset < size && Date.now() - started < budgetMs) {
    const end = Math.min(size, state.offset + 16 * 1024 * 1024) - 1;
    const piece = await downloadRange(token, String(item.options.fileId), state.offset, end, driveDeps());
    if (!piece.length) throw new CentreError("Drive sent an empty piece.");
    await fsp.appendFile(partial, piece);
    state.offset += piece.length;
  }
  if (state.offset < size) {
    await runs.saveStep(item.id, { phase: "download", state, progressDone: Math.floor((state.offset / Math.max(1, size)) * 100), progressTotal: 100, message: `Copying from Google Drive: ${Math.floor((state.offset / Math.max(1, size)) * 100)}%…` });
    return;
  }
  const { header } = await PackageReader.readHeader(partial).catch(() => {
    throw new CentreError("The file from Drive isn't an ARS backup package.");
  });
  const sha = await import("@/scripts/database/arsbak").then((mod) => mod.fileSha256(partial));
  await finishPackageFiles(partial, item.packageName!, sha, { kind: "drive", keyKind: header.kdf.alg === "server-key" ? "SERVER_KEY" : "PASSPHRASE", source: String(item.options.driveName ?? ""), createdByName: actor?.name ?? null });
  await runs.finishRun(item.id, "DONE", { phase: "done", message: `Copied to the server as ${item.packageName}. Check it, then restore.` });
}

// ---------- uploads from the PC ----------

export const UPLOAD_PIECE_MAX = 8 * 1024 * 1024;

export async function startUpload(input: { fileName: string; size: number }, actor: Actor): Promise<number> {
  if (!Number.isSafeInteger(input.size) || input.size < 64) throw new CentreError("That file is too small to be a backup package.");
  if (!/\.arsbak$/i.test(input.fileName)) throw new CentreError("Choose a .arsbak file made by ARS CMS.");
  const stored = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.part`;
  await fsp.mkdir(path.join(packagesDir(), ".incoming"), { recursive: true });
  await fsp.writeFile(path.join(packagesDir(), ".incoming", stored), Buffer.alloc(0), { mode: 0o600 });
  return runs.createUpload({ fileName: input.fileName.slice(0, 200), storedName: stored, size: input.size, createdBy: actor.id });
}

export async function receivePiece(id: number, offset: number, piece: Buffer, actor: Actor, arrival: { kind: PackageKind; source?: string } = { kind: "upload" }): Promise<{ received: number; size: number; packageName: string | null }> {
  const upload = await runs.getUpload(id);
  if (!upload || upload.status !== "RECEIVING") throw new CentreError("That upload isn't open any more. Start it again.", 404, "NOT_FOUND");
  if (offset !== upload.sizeReceived) return { received: upload.sizeReceived, size: upload.sizeExpected, packageName: null }; // the page carries on from here
  if (!piece.length || piece.length > UPLOAD_PIECE_MAX || offset + piece.length > upload.sizeExpected) throw new CentreError("That piece doesn't fit the file.");
  const partial = path.join(packagesDir(), ".incoming", upload.storedName);
  const current = (await fsp.stat(partial)).size;
  if (current !== offset) await fsp.truncate(partial, offset);
  if (offset === 0 && !piece.subarray(0, 6).equals(Buffer.from("ARSPK1"))) {
    await runs.finishUpload(id, "CANCELLED", null);
    await fsp.rm(partial, { force: true });
    throw new CentreError("That isn't an ARS backup package (.arsbak made by this app).");
  }
  await fsp.appendFile(partial, piece);
  if (!(await runs.advanceUpload(id, offset, offset + piece.length))) throw new CentreError("Another tab is uploading the same file.", 409, "BUSY");
  const received = offset + piece.length;
  if (received < upload.sizeExpected) return { received, size: upload.sizeExpected, packageName: null };
  const { header } = await PackageReader.readHeader(partial);
  const name = newPackageName(arrival.kind, String(id));
  const sha = await import("@/scripts/database/arsbak").then((mod) => mod.fileSha256(partial));
  await finishPackageFiles(partial, name, sha, { kind: arrival.kind, keyKind: header.kdf.alg === "server-key" ? "SERVER_KEY" : "PASSPHRASE", source: arrival.source ?? upload.fileName, createdByName: actor.name });
  await runs.finishUpload(id, "DONE", name);
  if (arrival.kind === "received") {
    await audit(actor.id ? actor : null, "BACKUP_MIGRATION_RECEIVED", name, { fileName: upload.fileName, bytes: upload.sizeExpected, from: arrival.source ?? null });
    await alertBackupEvent("MIGRATION_RECEIVED", `${upload.fileName} arrived from ${arrival.source ?? "another server"} as ${name}. Check it, then restore it here.`, null);
  } else {
    await audit(actor, "BACKUP_PACKAGE_UPLOADED", name, { fileName: upload.fileName, bytes: upload.sizeExpected });
    await alertBackupEvent("UPLOADED", `${upload.fileName} was uploaded as ${name}.`, actor.name);
  }
  return { received, size: upload.sizeExpected, packageName: name };
}

export async function cancelUpload(id: number): Promise<void> {
  const upload = await runs.getUpload(id);
  if (!upload || upload.status !== "RECEIVING") return;
  await fsp.rm(path.join(packagesDir(), ".incoming", upload.storedName), { force: true });
  await runs.finishUpload(id, "CANCELLED", null);
}

// ---------- downloads, deletes, secrets ----------

export async function recordDownload(name: string, actor: Actor): Promise<void> {
  await audit(actor, "BACKUP_PACKAGE_DOWNLOADED", name, {});
  await alertBackupEvent("DOWNLOADED", `${name} was downloaded. It holds the whole system and its secrets, encrypted with its passphrase.`, actor.name);
}

export async function afterDownload(name: string): Promise<void> {
  const meta = await readMeta(name);
  if (meta?.deleteAfterDownload) await deletePackage(name);
}

export async function removePackage(name: string, actor: Actor): Promise<boolean> {
  const restoring = await runs.activeRestore();
  if (restoring && (restoring.packageName === name || ((restoring.state as RestoreRunState | null)?.snapshotName ?? "") === name)) throw new CentreError("That package is being used by a restore.", 409, "BUSY");
  const removed = await deletePackage(name);
  if (removed) await audit(actor, "BACKUP_PACKAGE_DELETED", name, {});
  return removed;
}

// The server secrets inside a package: shown to the Super Admin after a
// restore or migration (D-408, owner: "show which env secrets to set").
// Needs the passphrase again; audited and alerted every time.
export async function revealSecrets(name: string, passphrase: string, actor: Actor): Promise<{ env: Record<string, string>; here: Record<string, "same" | "different" | "missing">; envFile: string }> {
  const file = packagePath(name);
  if (!file || !fs.existsSync(file)) throw new CentreError("That package isn't on the server any more.", 404, "NOT_FOUND");
  const { header } = await PackageReader.readHeader(file);
  const secret = header.kdf.alg === "server-key" && !passphrase && serverKey() ? { serverKey: serverKey()! } : { passphrase };
  const reader = await PackageReader.open(file, secret);
  const key = reader.key;
  await reader.close();
  const secrets = await engine.readSecrets(file, key);
  if (!secrets) throw new CentreError("This package holds no server secrets (only full packages do).");
  const here: Record<string, "same" | "different" | "missing"> = {};
  for (const [envName, value] of Object.entries(secrets.env)) here[envName] = process.env[envName] === undefined || process.env[envName] === "" ? "missing" : process.env[envName] === value ? "same" : "different";
  await audit(actor, "BACKUP_SECRETS_VIEWED", name, { names: Object.keys(secrets.env).length });
  await alertBackupEvent("SECRETS_VIEWED", `The server secrets inside ${name} were shown on screen.`, actor.name);
  // v1.82.0 (D-409): a ready .env for a VPS (this server's database, keys and folders; the package's other values).
  const { envFileFor } = await import("@/server/ops/backup-centre/moves");
  return { env: secrets.env, here, envFile: envFileFor(secrets.env, process.env) };
}

// ---------- what the page shows ----------

export async function centreSnapshot(): Promise<{ packages: PackageRow[]; runs: RunView[] }> {
  const [packages, recent] = await Promise.all([listPackages(), runs.listRuns(25)]);
  return {
    packages: packages.map((item) => ({
      name: item.name,
      bytes: item.bytes,
      createdAt: item.createdAt.toISOString(),
      kind: item.meta.kind,
      keyKind: item.meta.keyKind,
      appVersion: item.meta.appVersion ?? null,
      tables: item.meta.tables ?? null,
      rows: item.meta.rows ?? null,
      files: item.meta.files ?? null,
      checked: Boolean(item.meta.checked),
      source: item.meta.source ?? null,
      createdBy: item.meta.createdByName ?? null,
      deleteAfterDownload: Boolean(item.meta.deleteAfterDownload),
    })),
    runs: recent.map(toView),
  };
}

// ---------- the job runner (scheduled packages, idle runs, retention) ----------

export async function runBackupCentreJob(budgetMs = 90_000): Promise<Record<string, string | number>> {
  const started = Date.now();
  const counts: Record<string, string | number> = {};
  const mode = await getSettingValue("features.backup_centre").catch(() => "OFF");
  if (mode === "OFF") return { backupCentre: "OFF" };

  // Runs a person started and left (no step for 30 minutes) stop safely;
  // a restore past its switch, scheduled work and Drive copies carry on.
  for (const item of await runs.idleRuns(30)) {
    const continuable = item.trigger !== "MANUAL" || item.kind === "DRIVE_COPY" || item.kind === "DRIVE_FETCH" || item.kind === "S3_COPY" || item.kind === "S3_FETCH" || item.kind === "LIVE_CHECK" || (item.kind === "RESTORE" && ["finalize", "migrate", "rollback", "verify"].includes(item.phase)) || (item.kind === "BACKUP" && item.phase === "drive") || (item.kind === "DB_COPY" && !["build", "snapshot", "load"].includes(item.phase));
    if (continuable) continue;
    if (!(await runs.claimStep(item.id, 60))) continue;
    await abandon(item).catch((error) => logError("abandon backup run failed", error, { runId: item.id }));
    await runs.finishRun(item.id, "CANCELLED", { message: "Stopped: nobody carried it on for 30 minutes (the passphrase is never stored). Nothing was changed." });
    counts.cancelled = Number(counts.cancelled ?? 0) + 1;
  }

  // A scheduled package when due.
  const schedule = await getSettingValue("backup.package_schedule").catch(() => "OFF");
  if (schedule === "DAILY" || schedule === "WEEKLY") {
    const last = await runs.lastFinished("BACKUP", "SCHEDULED");
    const dueHours = schedule === "DAILY" ? 23 : 24 * 7 - 1;
    const running = (await runs.runningRuns(["BACKUP"])).some((item) => item.trigger === "SCHEDULED");
    if (!running && (!last || Date.now() - last.createdAt.getTime() > dueHours * 3_600_000)) {
      if (!serverKey()) counts.scheduled = "NO_KEY";
      else {
        const name = newPackageName("scheduled");
        await fsp.mkdir(packagesDir(), { recursive: true });
        await runs.createRun({ kind: "BACKUP", trigger: "SCHEDULED", phase: "build", mode: "full", packageName: name, keyKind: "SERVER_KEY", options: { keepOnServer: true, copyToDrive: (await getSettingValue("backup.package_drive").catch(() => "OFF")) === "ON" }, createdBy: null, withToken: false });
        counts.scheduled = "STARTED";
      }
    }
  }

  // Carry on runs that need no person.
  for (const item of await runs.runningRuns()) {
    if (Date.now() - started > budgetMs) break;
    const unattended = item.trigger !== "MANUAL" || item.kind === "DRIVE_COPY" || item.kind === "DRIVE_FETCH" || item.kind === "S3_COPY" || item.kind === "S3_FETCH" || item.kind === "LIVE_CHECK" || (item.kind === "RESTORE" && ["finalize", "migrate", "rollback"].includes(item.phase)) || (item.kind === "BACKUP" && item.phase === "drive");
    if (!unattended) continue;
    // A person's run is only taken over when nobody stepped it for 2 minutes.
    if (item.trigger === "MANUAL" && Date.now() - item.updatedAt.getTime() < 120_000) continue;
    for (let steps = 0; steps < 50 && Date.now() - started < budgetMs; steps += 1) {
      const view = await stepRun(item.id, {}, null, Math.min(60_000, budgetMs - (Date.now() - started))).catch((error) => {
        logError("backup centre job step failed", error, { runId: item.id });
        return null;
      });
      if (!view || view.status !== "RUNNING") {
        if (view?.status === "DONE" && item.kind === "BACKUP" && item.trigger === "SCHEDULED") counts.scheduled = "DONE";
        break;
      }
    }
  }

  // Retention: the newest N scheduled packages, download-only packages for 24 hours, stale uploads.
  const keep = Number(await getSettingValue("backup.package_keep").catch(() => "7")) || 7;
  const all = await listPackages();
  let deleted = 0;
  for (const old of all.filter((item) => item.meta.kind === "scheduled").slice(keep)) deleted += (await deletePackage(old.name)) ? 1 : 0;
  for (const item of all.filter((entry) => entry.meta.deleteAfterDownload && Date.now() - entry.createdAt.getTime() > 24 * 3_600_000)) deleted += (await deletePackage(item.name)) ? 1 : 0;
  for (const upload of await runs.staleUploads(24)) await cancelUpload(upload.id);
  if (deleted) counts.packagesDeleted = deleted;
  return counts;
}
