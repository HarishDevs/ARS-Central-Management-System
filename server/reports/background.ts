import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { getEnv } from "@/config/environment";
import { cleanQuery, prepareReport, runReport, type ReportQuery } from "@/server/reports/run";
import { exportReport, fileName, type ExportFormat } from "@/server/reports/export";
import { BACKGROUND_MAX_ROWS, MAX_ROWS, REPORT, rowCap } from "@/server/reports/catalogue";
import { canExport, canUseReports } from "@/server/settings/features";
import { notify } from "@/server/notifications/notify";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { logError } from "@/lib/logging/logger";
import { appBaseUrl } from "@/lib/http/app-url";

// v1.7.0 (C02): large exports made in the background. Requested from a
// report page; the job runner (or the request itself, right after it is
// answered) makes the file with the person's permissions at that moment,
// writes it to private storage and tells them in the app. Only they can
// download it, for 7 days. CSV and Excel go up to 50,000 rows; PDF keeps
// the 5,000-row limit.
export const EXPORT_KEEP_DAYS = 7;
const MAX_QUEUED_PER_PERSON = 3;

export function exportDir(): string {
  const env = getEnv();
  if (env.BACKUP_DIR) return path.join(path.dirname(path.resolve(env.BACKUP_DIR)), "exports");
  if (env.UPLOAD_DIR) return path.join(path.dirname(path.resolve(env.UPLOAD_DIR)), "exports");
  return path.resolve(path.join(process.cwd(), "storage", "exports"));
}

export interface ExportJob {
  id: number;
  reportKey: string;
  format: ExportFormat;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "EXPIRED";
  rows: number | null;
  bytes: number | null;
  message: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

type Row = RowDataPacket & { id: number; user_id: number; report_key: string; query_json: unknown; format: ExportFormat; status: ExportJob["status"]; attempts: number; file_name: string | null; row_count: number | null; bytes: number | null; message: string | null; created_at: Date; expires_at: Date | null };
const toJob = (row: Row): ExportJob => ({ id: row.id, reportKey: row.report_key, format: row.format, status: row.status, rows: row.row_count, bytes: row.bytes, message: row.message, createdAt: row.created_at, expiresAt: row.expires_at });

export async function listExports(userId: number, limit = 10): Promise<ExportJob[]> {
  const [rows] = await getDbPool().query<Row[]>("SELECT * FROM export_jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?", [userId, limit]);
  return rows.map(toJob);
}

export async function requestExport(user: { id: number; roles: readonly string[] }, reportKey: string, query: ReportQuery, format: ExportFormat): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  if (!(await canUseReports(user))) return { ok: false, message: "Not found." };
  if (!(await canExport(user))) return { ok: false, message: "Downloads are limited to people with the Can export permission." };
  if (!(await prepareReport(reportKey, query, user))) return { ok: false, message: "Not found." };
  const db = getDbPool();
  const [[waiting]] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM export_jobs WHERE user_id = ? AND status IN ('QUEUED', 'RUNNING')", [user.id]);
  if (Number(waiting?.n ?? 0) >= MAX_QUEUED_PER_PERSON) return { ok: false, message: `You have ${MAX_QUEUED_PER_PERSON} exports being made. Wait for one to finish.` };
  const [result] = await db.query<ResultSetHeader>("INSERT INTO export_jobs (user_id, report_key, query_json, format) VALUES (?, ?, ?, ?)", [user.id, reportKey, JSON.stringify(query), format]);
  return { ok: true, id: result.insertId };
}

async function rolesOf(userId: number): Promise<{ active: boolean; roles: string[] } | null> {
  const db = getDbPool();
  const [users] = await db.query<(RowDataPacket & { active: number })[]>("SELECT active FROM users WHERE id = ?", [userId]);
  if (!users[0]) return null;
  const [roles] = await db.query<(RowDataPacket & { code: string })[]>("SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.active = TRUE", [userId]);
  return { active: Boolean(users[0].active), roles: roles.map((row) => row.code) };
}

// v1.57.6 (D-348, owner): an export is tried at most 3 times. Each claim
// (QUEUED -> RUNNING) adds one to attempts, and that number is the claim's
// identity: a run that was given up on (or put back) can't finish or fail a
// newer claim. The third failed try is final and the requester is told.
export const EXPORT_MAX_ATTEMPTS = 3;

// v1.57.6 (D-348, owner): after a failed try (an error, or a run that died),
// the export goes back to the queue until its third try, then it is FAILED.
export function exportAfterFailure(attempts: number): "QUEUED" | "FAILED" {
  return attempts >= EXPORT_MAX_ATTEMPTS ? "FAILED" : "QUEUED";
}

// v1.57.6 (D-348, owner): the requester hears about a failed export in the
// app, on the same path (and Inbox category) as "Your export is ready".
async function tellExportFailed(job: { id: number; userId: number; reportKey: string }, message: string): Promise<void> {
  await notify({
    eventType: "EXPORT_READY",
    userId: job.userId,
    title: "Your export couldn't be made",
    message: `${REPORT[job.reportKey]?.name ?? job.reportKey}: ${message.slice(0, 200)} Ask for it again from Reports.`,
    deepLink: `${appBaseUrl()}/admin/reports#exports`,
    email: null,
    whatsappVariables: null,
  }).catch((error) => logError("export failure notify failed", error, { exportId: job.id }));
}

// Makes one queued export. The job is claimed first (QUEUED → RUNNING), so
// two runners never make the same file.
export async function runExportJob(id: number): Promise<"DONE" | "FAILED" | "RETRY" | "SKIPPED"> {
  const db = getDbPool();
  // v1.57.6 (D-348, owner): the claim counts the try.
  const [claim] = await db.query<ResultSetHeader>("UPDATE export_jobs SET status = 'RUNNING', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'QUEUED'", [id]);
  if (claim.affectedRows !== 1) return "SKIPPED";
  const [rows] = await db.query<Row[]>("SELECT * FROM export_jobs WHERE id = ?", [id]);
  const job = rows[0]!;
  const attempt = Number(job.attempts);
  // v1.57.6 (D-348, owner): every write below applies only while this claim
  // is still the current one (RUNNING with the same attempt number).
  const fail = async (message: string): Promise<"FAILED" | "SKIPPED"> => {
    const [failed] = await db.query<ResultSetHeader>("UPDATE export_jobs SET status = 'FAILED', message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RUNNING' AND attempts = ?", [message.slice(0, 300), id, attempt]);
    if (failed.affectedRows !== 1) return "SKIPPED";
    await tellExportFailed({ id, userId: job.user_id, reportKey: job.report_key }, message);
    return "FAILED";
  };
  const retryOrFail = async (message: string): Promise<"FAILED" | "RETRY" | "SKIPPED"> => {
    if (exportAfterFailure(attempt) === "FAILED") return fail(`${message.slice(0, 200)} (gave up after ${EXPORT_MAX_ATTEMPTS} tries)`);
    const [back] = await db.query<ResultSetHeader>("UPDATE export_jobs SET status = 'QUEUED', message = ? WHERE id = ? AND status = 'RUNNING' AND attempts = ?", [message.slice(0, 300), id, attempt]);
    return back.affectedRows === 1 ? "RETRY" : "SKIPPED";
  };
  try {
    const person = await rolesOf(job.user_id);
    if (!person?.active) return await fail("The account is inactive.");
    const viewer = { id: job.user_id, roles: person.roles };
    if (!(await canUseReports(viewer))) return await fail("Reports are for the IT team only.");
    if (!(await canExport(viewer))) return await fail("Downloads are limited to the Can export permission.");
    const query = cleanQuery((typeof job.query_json === "string" ? JSON.parse(job.query_json) : job.query_json) as Record<string, unknown>);
    const now = new Date();
    const cap = job.format === "pdf" ? MAX_ROWS : BACKGROUND_MAX_ROWS;
    const ran = await rowCap.run(cap, () => runReport(job.report_key, query, viewer, now));
    if (!ran) return await fail("You can no longer run this report.");
    const [names] = await db.query<(RowDataPacket & { name: string })[]>("SELECT name FROM users WHERE id = ?", [job.user_id]);
    const body = await exportReport(job.format, ran.result, {
      title: ran.report.name,
      scopeLabel: ran.scope.label,
      periodLabel: ran.report.usesPeriod ? `${ran.filter.period.label} (${ran.filter.period.from} to ${ran.filter.period.to})` : null,
      generatedAt: now,
      generatedBy: names[0]?.name ?? "",
    });
    const bytes = typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
    const dir = exportDir();
    await fs.mkdir(dir, { recursive: true });
    const stored = `${id}-${crypto.randomBytes(12).toString("hex")}.${job.format}`;
    await fs.writeFile(path.join(dir, stored), bytes, { flag: "wx" });
    const [done] = await db.query<ResultSetHeader>(
      "UPDATE export_jobs SET status = 'DONE', file_name = ?, row_count = ?, bytes = ?, message = ?, finished_at = CURRENT_TIMESTAMP, expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY) WHERE id = ? AND status = 'RUNNING' AND attempts = ?",
      [stored, ran.result.rows.length, bytes.byteLength, ran.result.truncated ? `First ${cap.toLocaleString("en-IN")} rows only.` : null, EXPORT_KEEP_DAYS, id, attempt],
    );
    if (done.affectedRows !== 1) {
      // v1.57.6 (D-348, owner): this run was given up on meanwhile; a newer
      // claim (or the final failure) owns the job, so this file is dropped.
      await fs.rm(path.join(dir, stored), { force: true }).catch(() => undefined);
      return "SKIPPED";
    }
    await recordAudit({ actorUserId: job.user_id, action: "REPORT_EXPORTED", entityType: "REPORT", entityId: job.report_key, metadata: { format: job.format, scope: ran.scope.kind, rows: ran.result.rows.length, truncated: ran.result.truncated, background: true, exportId: id } });
    const base = appBaseUrl();
    await notify({
      eventType: "EXPORT_READY",
      userId: job.user_id,
      title: "Your export is ready",
      message: `${ran.report.name}: ${ran.result.rows.length.toLocaleString("en-IN")} rows. Download it within ${EXPORT_KEEP_DAYS} days.`,
      deepLink: `${base}/admin/reports#exports`,
      email: null,
      whatsappVariables: null,
    }).catch((error) => logError("export notify failed", error, { exportId: id }));
    return "DONE";
  } catch (error) {
    logError("background export failed", error, { exportId: id });
    // v1.57.6 (D-348, owner): an unexpected error is retried, up to 3 tries.
    return retryOrFail(error instanceof Error ? `${error.name}: ${error.message}` : "Failed");
  }
}

// v1.57.6 (D-348, owner): a RUNNING export older than 30 minutes (its runner
// died) goes back to the queue until its third try; then it is FAILED and the
// requester is told. Only that same claim is touched (status + attempts).
export async function recoverStuckExports(): Promise<{ requeued: number; gaveUp: number }> {
  const db = getDbPool();
  const [stuck] = await db.query<(RowDataPacket & { id: number; user_id: number; report_key: string; attempts: number })[]>(
    "SELECT id, user_id, report_key, attempts FROM export_jobs WHERE status = 'RUNNING' AND started_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE) ORDER BY id LIMIT 200",
  );
  const out = { requeued: 0, gaveUp: 0 };
  for (const row of stuck) {
    const attempts = Number(row.attempts);
    if (exportAfterFailure(attempts) === "QUEUED") {
      const [back] = await db.query<ResultSetHeader>("UPDATE export_jobs SET status = 'QUEUED', message = 'The last try stopped before finishing; trying again.' WHERE id = ? AND status = 'RUNNING' AND attempts = ?", [row.id, attempts]);
      out.requeued += back.affectedRows;
      continue;
    }
    const message = `The export stopped before finishing ${EXPORT_MAX_ATTEMPTS} times.`;
    const [failed] = await db.query<ResultSetHeader>("UPDATE export_jobs SET status = 'FAILED', message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RUNNING' AND attempts = ?", [message, row.id, attempts]);
    if (failed.affectedRows !== 1) continue;
    out.gaveUp += 1;
    await tellExportFailed({ id: row.id, userId: row.user_id, reportKey: row.report_key }, message);
  }
  return out;
}

// Job-runner step: make queued exports (oldest first), and remove files
// past their 7 days. A RUNNING job older than 30 minutes (runner died) is
// given back to the queue (v1.57.6: up to its third try, see above).
export async function runExportJobs(limit = 5): Promise<{ exportsMade: number; exportsFailed: number; exportsRetried: number; exportsRequeued: number; exportsGaveUp: number; exportsExpired: number }> {
  const db = getDbPool();
  const recovered = await recoverStuckExports();
  const [queued] = await db.query<(RowDataPacket & { id: number })[]>("SELECT id FROM export_jobs WHERE status = 'QUEUED' ORDER BY id LIMIT ?", [limit]);
  const out = { exportsMade: 0, exportsFailed: 0, exportsRetried: 0, exportsRequeued: recovered.requeued, exportsGaveUp: recovered.gaveUp, exportsExpired: 0 };
  for (const row of queued) {
    const result = await runExportJob(row.id);
    if (result === "DONE") out.exportsMade += 1;
    else if (result === "FAILED") out.exportsFailed += 1;
    else if (result === "RETRY") out.exportsRetried += 1;
  }
  out.exportsExpired = await pruneExports();
  return out;
}

export async function pruneExports(): Promise<number> {
  const db = getDbPool();
  const [rows] = await db.query<(RowDataPacket & { id: number; file_name: string | null })[]>("SELECT id, file_name FROM export_jobs WHERE status = 'DONE' AND expires_at < CURRENT_TIMESTAMP LIMIT 200");
  for (const row of rows) {
    if (row.file_name && /^\d+-[0-9a-f]{24}\.(csv|xlsx|pdf)$/.test(row.file_name)) await fs.rm(path.join(exportDir(), row.file_name), { force: true }).catch(() => undefined);
    // v1.57.6 (D-348, owner): only a row that is still DONE is expired.
    await db.query("UPDATE export_jobs SET status = 'EXPIRED', file_name = NULL WHERE id = ? AND status = 'DONE'", [row.id]);
  }
  return rows.length;
}

// For the download route: the owner's finished, unexpired export.
export async function openExport(id: number, userId: number): Promise<{ body: Buffer; name: string; format: ExportFormat } | null> {
  const [rows] = await getDbPool().query<Row[]>("SELECT * FROM export_jobs WHERE id = ? AND user_id = ? AND status = 'DONE' AND expires_at > CURRENT_TIMESTAMP", [id, userId]);
  const job = rows[0];
  if (!job?.file_name || !/^\d+-[0-9a-f]{24}\.(csv|xlsx|pdf)$/.test(job.file_name)) return null;
  try {
    const body = await fs.readFile(path.join(exportDir(), job.file_name));
    return { body, name: fileName(job.report_key, job.format, job.created_at), format: job.format };
  } catch {
    return null;
  }
}
