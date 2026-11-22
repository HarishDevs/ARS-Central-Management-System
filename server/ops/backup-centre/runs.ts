import "server-only";
import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";

// D-408 (v1.81.0, BK-1): the centre's runs (backup_runs). A run is driven in
// steps; a step holds a short lease so two tabs (or a tab and the job
// runner) never work on the same run at once. Nothing secret is stored.
export type RunKind = "BACKUP" | "VERIFY" | "RESTORE" | "DRIVE_COPY" | "DRIVE_FETCH";
export type RunStatus = "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | "ROLLED_BACK";
export type RunTrigger = "MANUAL" | "SCHEDULED" | "SAFETY";

export interface BackupRun {
  id: number;
  kind: RunKind;
  trigger: RunTrigger;
  status: RunStatus;
  phase: string;
  mode: string | null;
  packageName: string | null;
  keyKind: "PASSPHRASE" | "SERVER_KEY" | null;
  options: Record<string, unknown>;
  state: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  progressDone: number;
  progressTotal: number;
  message: string | null;
  error: string | null;
  tokenHash: string | null;
  parentRunId: number | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

const json = (value: unknown): Record<string, unknown> | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value as Record<string, unknown>;
};

function toRun(row: RowDataPacket): BackupRun {
  return {
    id: Number(row.id),
    kind: row.kind,
    trigger: row.trigger_type,
    status: row.status,
    phase: row.phase,
    mode: row.mode ?? null,
    packageName: row.package_name ?? null,
    keyKind: row.key_kind ?? null,
    options: json(row.options_json) ?? {},
    state: json(row.state_json),
    summary: json(row.summary_json),
    progressDone: Number(row.progress_done),
    progressTotal: Number(row.progress_total),
    message: row.message ?? null,
    error: row.error_text ?? null,
    tokenHash: row.token_hash ?? null,
    parentRunId: row.parent_run_id === null ? null : Number(row.parent_run_id),
    createdBy: row.created_by === null ? null : Number(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? null,
  };
}

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function createRun(input: {
  kind: RunKind;
  trigger: RunTrigger;
  phase: string;
  mode?: string | null;
  packageName?: string | null;
  keyKind?: "PASSPHRASE" | "SERVER_KEY" | null;
  options?: Record<string, unknown>;
  parentRunId?: number | null;
  createdBy: number | null;
  activeSlot?: "RESTORE" | null;
  withToken?: boolean;
}): Promise<{ id: number; token: string | null }> {
  const token = input.withToken === false ? null : crypto.randomBytes(32).toString("base64url");
  const [result] = await getDbPool().query<ResultSetHeader>(
    `INSERT INTO backup_runs (kind, trigger_type, status, phase, mode, package_name, key_kind, options_json, token_hash, active_slot, parent_run_id, created_by)
     VALUES (?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.kind, input.trigger, input.phase, input.mode ?? null, input.packageName ?? null, input.keyKind ?? null, JSON.stringify(input.options ?? {}), token ? hashToken(token) : null, input.activeSlot ?? null, input.parentRunId ?? null, input.createdBy],
  );
  return { id: result.insertId, token };
}

export async function getRun(id: number): Promise<BackupRun | null> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT * FROM backup_runs WHERE id = ?", [id]);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function listRuns(limit = 30): Promise<BackupRun[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT * FROM backup_runs ORDER BY id DESC LIMIT ?", [limit]);
  return rows.map(toRun);
}

export async function runningRuns(kinds?: RunKind[]): Promise<BackupRun[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(`SELECT * FROM backup_runs WHERE status = 'RUNNING'${kinds?.length ? ` AND kind IN (${kinds.map(() => "?").join(", ")})` : ""} ORDER BY id`, kinds ?? []);
  return rows.map(toRun);
}

export async function activeRestore(): Promise<BackupRun | null> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT * FROM backup_runs WHERE active_slot = 'RESTORE' LIMIT 1");
  return rows[0] ? toRun(rows[0]) : null;
}

export async function lastFinished(kind: RunKind, trigger: RunTrigger): Promise<BackupRun | null> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT * FROM backup_runs WHERE kind = ? AND trigger_type = ? AND status = 'DONE' ORDER BY id DESC LIMIT 1", [kind, trigger]);
  return rows[0] ? toRun(rows[0]) : null;
}

// A step may run when no other step holds the run (or its lease ran out).
export async function claimStep(id: number, seconds = 150): Promise<boolean> {
  const [result] = await getDbPool().query<ResultSetHeader>(
    "UPDATE backup_runs SET lease_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND) WHERE id = ? AND status = 'RUNNING' AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP(3))",
    [seconds, id],
  );
  return result.affectedRows === 1;
}

export async function saveStep(id: number, input: { phase: string; state: unknown; progressDone?: number; progressTotal?: number; message?: string | null; summary?: unknown; packageName?: string | null; keepLease?: boolean }): Promise<void> {
  await getDbPool().query(
    `UPDATE backup_runs SET phase = ?, state_json = ?, progress_done = COALESCE(?, progress_done), progress_total = COALESCE(?, progress_total),
            message = COALESCE(?, message), summary_json = COALESCE(?, summary_json), package_name = COALESCE(?, package_name)${input.keepLease ? "" : ", lease_until = NULL"}
      WHERE id = ?`,
    [input.phase, JSON.stringify(input.state ?? null), input.progressDone ?? null, input.progressTotal ?? null, input.message ?? null, input.summary === undefined ? null : JSON.stringify(input.summary), input.packageName ?? null, id],
  );
}

export async function releaseLease(id: number): Promise<void> {
  await getDbPool().query("UPDATE backup_runs SET lease_until = NULL WHERE id = ?", [id]);
}

export async function finishRun(id: number, status: Exclude<RunStatus, "RUNNING">, input: { message?: string | null; error?: string | null; summary?: unknown; phase?: string } = {}): Promise<void> {
  await getDbPool().query(
    `UPDATE backup_runs SET status = ?, phase = COALESCE(?, phase), message = COALESCE(?, message), error_text = ?, summary_json = COALESCE(?, summary_json),
            lease_until = NULL, active_slot = NULL, token_hash = NULL, finished_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?`,
    [status, input.phase ?? null, input.message ?? null, input.error ? input.error.slice(0, 1000) : null, input.summary === undefined ? null : JSON.stringify(input.summary), id],
  );
}

// Runs nobody has moved on for `minutes` (a closed tab, a lost passphrase).
export async function idleRuns(minutes: number): Promise<BackupRun[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>(
    "SELECT * FROM backup_runs WHERE status = 'RUNNING' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE) AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP(3))",
    [minutes],
  );
  return rows.map(toRun);
}

// ---------- uploads ----------
export interface BackupUpload {
  id: number;
  fileName: string;
  storedName: string;
  sizeExpected: number;
  sizeReceived: number;
  status: "RECEIVING" | "DONE" | "CANCELLED";
  packageName: string | null;
  createdBy: number | null;
}

function toUpload(row: RowDataPacket): BackupUpload {
  return { id: Number(row.id), fileName: row.file_name, storedName: row.stored_name, sizeExpected: Number(row.size_expected), sizeReceived: Number(row.size_received), status: row.status, packageName: row.package_name ?? null, createdBy: row.created_by === null ? null : Number(row.created_by) };
}

export async function createUpload(input: { fileName: string; storedName: string; size: number; createdBy: number }): Promise<number> {
  const [result] = await getDbPool().query<ResultSetHeader>("INSERT INTO backup_uploads (file_name, stored_name, size_expected, status, created_by) VALUES (?, ?, ?, 'RECEIVING', ?)", [input.fileName, input.storedName, input.size, input.createdBy]);
  return result.insertId;
}

export async function getUpload(id: number): Promise<BackupUpload | null> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT * FROM backup_uploads WHERE id = ?", [id]);
  return rows[0] ? toUpload(rows[0]) : null;
}

// Only the piece that starts exactly where the file ends is accepted.
export async function advanceUpload(id: number, from: number, to: number): Promise<boolean> {
  const [result] = await getDbPool().query<ResultSetHeader>("UPDATE backup_uploads SET size_received = ? WHERE id = ? AND status = 'RECEIVING' AND size_received = ?", [to, id, from]);
  return result.affectedRows === 1;
}

export async function finishUpload(id: number, status: "DONE" | "CANCELLED", packageName: string | null): Promise<void> {
  await getDbPool().query("UPDATE backup_uploads SET status = ?, package_name = ? WHERE id = ?", [status, packageName, id]);
}

export async function staleUploads(hours: number): Promise<BackupUpload[]> {
  const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT * FROM backup_uploads WHERE status = 'RECEIVING' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)", [hours]);
  return rows.map(toUpload);
}
