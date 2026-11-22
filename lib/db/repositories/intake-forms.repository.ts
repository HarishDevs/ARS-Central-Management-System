import "server-only";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { parseDraft, parseSettings, type IntakeDraft, type IntakeSettings } from "@/server/work/intake-rules";

// v1.66.0 (D-374, PM phase C): project intake forms, their published
// versions and submissions. Raw SQL; the service checks who may do what.
type Row = RowDataPacket & Record<string, unknown>;
const num = (value: unknown) => Number(value);
const maybeNum = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const str = (value: unknown) => (value === null || value === undefined ? null : String(value));
const json = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export type FormStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
export interface FormRecord {
  id: number;
  projectId: number;
  projectName: string;
  token: string;
  status: FormStatus;
  name: string;
  description: string | null;
  coverPath: string | null;
  coverType: string | null;
  draft: IntakeDraft;
  settings: IntakeSettings;
  currentVersionId: number | null;
  versionNo: number | null;
  draftChanged: boolean;
  rowVersion: number;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
export interface FormSnapshot {
  name: string;
  description: string | null;
  hasCover: boolean;
  draft: IntakeDraft;
  settings: IntakeSettings;
}

const SELECT = `SELECT f.*, p.name AS project_name, v.version_no FROM project_forms f JOIN projects p ON p.id = f.project_id LEFT JOIN project_form_versions v ON v.id = f.current_version_id`;
const toForm = (row: Row): FormRecord => ({
  id: num(row.id),
  projectId: num(row.project_id),
  projectName: String(row.project_name),
  token: String(row.share_token),
  status: row.status as FormStatus,
  name: String(row.name),
  description: str(row.description),
  coverPath: str(row.cover_path),
  coverType: str(row.cover_type),
  draft: parseDraft(json(row.draft_json)),
  settings: parseSettings(json(row.settings_json)),
  currentVersionId: maybeNum(row.current_version_id),
  versionNo: maybeNum(row.version_no),
  draftChanged: Boolean(row.draft_changed),
  rowVersion: num(row.row_version),
  createdBy: num(row.created_by),
  createdAt: row.created_at as Date,
  updatedAt: row.updated_at as Date,
  deletedAt: (row.deleted_at as Date | null) ?? null,
});

export async function findForm(id: number, db: Queryable = getDbPool(), lock = false): Promise<FormRecord | null> {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE f.id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ? toForm(rows[0]) : null;
}
export async function findFormByToken(token: string, db: Queryable = getDbPool()): Promise<FormRecord | null> {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE f.share_token = ? AND f.deleted_at IS NULL`, [token]);
  return rows[0] ? toForm(rows[0]) : null;
}
export async function listProjectForms(projectId: number, db: Queryable = getDbPool()): Promise<FormRecord[]> {
  const [rows] = await db.query<Row[]>(`${SELECT} WHERE f.project_id = ? AND f.deleted_at IS NULL ORDER BY f.id`, [projectId]);
  return rows.map(toForm);
}
export async function countProjectForms(projectId: number, db: Queryable): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM project_forms WHERE project_id = ? AND deleted_at IS NULL", [projectId]);
  return num(rows[0]?.n ?? 0);
}
// Published forms of live projects (the Home widget filters them by who may submit).
export async function listPublishedForms(limit = 200, db: Queryable = getDbPool()): Promise<FormRecord[]> {
  const [rows] = await db.query<Row[]>(
    `${SELECT} WHERE f.status = 'PUBLISHED' AND f.deleted_at IS NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL AND f.current_version_id IS NOT NULL ORDER BY f.updated_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toForm);
}

export interface NewForm {
  projectId: number;
  token: string;
  name: string;
  description: string | null;
  draft: IntakeDraft;
  settings: IntakeSettings;
  createdBy: number;
  coverPath?: string | null;
  coverType?: string | null;
}
export async function insertForm(form: NewForm, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO project_forms (project_id, share_token, name, description, draft_json, settings_json, created_by, updated_by, cover_path, cover_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [form.projectId, form.token, form.name, form.description, JSON.stringify(form.draft), JSON.stringify(form.settings), form.createdBy, form.createdBy, form.coverPath ?? null, form.coverType ?? null],
  );
  return result.insertId;
}
// Save the draft, guarded by the row version (two builders at once: the second is told).
export async function saveDraft(id: number, expectedVersion: number, change: { name: string; description: string | null; draft: IntakeDraft; settings: IntakeSettings }, by: number, db: Queryable): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    "UPDATE project_forms SET name = ?, description = ?, draft_json = ?, settings_json = ?, draft_changed = TRUE, updated_by = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND deleted_at IS NULL",
    [change.name, change.description, JSON.stringify(change.draft), JSON.stringify(change.settings), by, id, expectedVersion],
  );
  return result.affectedRows === 1;
}
export async function setCover(id: number, cover: { path: string; type: string } | null, by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_forms SET cover_path = ?, cover_type = ?, draft_changed = TRUE, updated_by = ?, row_version = row_version + 1 WHERE id = ?", [cover?.path ?? null, cover?.type ?? null, by, id]);
}
export async function nextVersionNo(formId: number, db: Queryable): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM project_form_versions WHERE form_id = ?", [formId]);
  return num(rows[0]?.n ?? 1);
}
export async function insertVersion(formId: number, versionNo: number, snapshot: FormSnapshot, by: number, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>("INSERT INTO project_form_versions (form_id, version_no, snapshot_json, published_by) VALUES (?, ?, ?, ?)", [formId, versionNo, JSON.stringify(snapshot), by]);
  return result.insertId;
}
export async function markPublished(formId: number, versionId: number, by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_forms SET status = 'PUBLISHED', current_version_id = ?, draft_changed = FALSE, updated_by = ?, row_version = row_version + 1 WHERE id = ?", [versionId, by, formId]);
}
export async function setStatus(formId: number, status: FormStatus, by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_forms SET status = ?, updated_by = ?, row_version = row_version + 1 WHERE id = ?", [status, by, formId]);
}
export async function softDelete(formId: number, by: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE project_forms SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?, status = 'UNPUBLISHED', row_version = row_version + 1 WHERE id = ?", [by, formId]);
}
export async function findVersion(versionId: number, db: Queryable = getDbPool()): Promise<{ id: number; formId: number; versionNo: number; snapshot: FormSnapshot } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, form_id, version_no, snapshot_json FROM project_form_versions WHERE id = ?", [versionId]);
  const row = rows[0];
  if (!row) return null;
  const raw = (json(row.snapshot_json) ?? {}) as Record<string, unknown>;
  return {
    id: num(row.id),
    formId: num(row.form_id),
    versionNo: num(row.version_no),
    snapshot: { name: String(raw.name ?? ""), description: typeof raw.description === "string" ? raw.description : null, hasCover: Boolean(raw.hasCover), draft: parseDraft(raw.draft), settings: parseSettings(raw.settings) },
  };
}

// ---- submissions ------------------------------------------------------------------------------
export async function findSubmissionByKey(formId: number, submitterId: number, key: string, db: Queryable = getDbPool()): Promise<{ id: number; taskId: number | null } | null> {
  const [rows] = await db.query<Row[]>("SELECT id, task_id FROM project_form_submissions WHERE form_id = ? AND submitter_id = ? AND submission_key = ?", [formId, submitterId, key]);
  return rows[0] ? { id: num(rows[0].id), taskId: maybeNum(rows[0].task_id) } : null;
}
export async function countRecentSubmissions(formId: number, submitterId: number, seconds: number, db: Queryable = getDbPool()): Promise<number> {
  const [rows] = await db.query<Row[]>("SELECT COUNT(*) AS n FROM project_form_submissions WHERE form_id = ? AND submitter_id = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)", [formId, submitterId, seconds]);
  return num(rows[0]?.n ?? 0);
}
export async function insertSubmission(row: { formId: number; versionId: number; submitterId: number; key: string; taskId: number; answers: Record<string, unknown> }, db: Queryable): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    "INSERT INTO project_form_submissions (form_id, version_id, submitter_id, submission_key, task_id, answers_json) VALUES (?, ?, ?, ?, ?, ?)",
    [row.formId, row.versionId, row.submitterId, row.key, row.taskId, JSON.stringify(row.answers)],
  );
  return result.insertId;
}
export async function countSubmissions(formIds: readonly number[], db: Queryable = getDbPool()): Promise<Map<number, number>> {
  if (!formIds.length) return new Map();
  const [rows] = await db.query<Row[]>("SELECT form_id, COUNT(*) AS n FROM project_form_submissions WHERE form_id IN (?) GROUP BY form_id", [formIds]);
  return new Map(rows.map((row) => [num(row.form_id), num(row.n)]));
}
export interface MySubmission {
  id: number;
  formName: string;
  projectName: string;
  taskId: number | null;
  taskNo: string | null;
  taskTitle: string | null;
  createdAt: Date;
}
export async function listMySubmissions(submitterId: number, limit = 10, db: Queryable = getDbPool()): Promise<MySubmission[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT s.id, f.name AS form_name, p.name AS project_name, s.task_id, t.task_no, t.title, s.created_at
     FROM project_form_submissions s JOIN project_forms f ON f.id = s.form_id JOIN projects p ON p.id = f.project_id
     LEFT JOIN tasks t ON t.id = s.task_id AND t.deleted_at IS NULL
     WHERE s.submitter_id = ? ORDER BY s.id DESC LIMIT ?`,
    [submitterId, limit],
  );
  return rows.map((row) => ({ id: num(row.id), formName: String(row.form_name), projectName: String(row.project_name), taskId: maybeNum(row.task_id), taskNo: str(row.task_no), taskTitle: str(row.title), createdAt: row.created_at as Date }));
}

// ---- the system user (C-10) ----------------------------------------------------------------
export const SYSTEM_LOGIN_ID = "ars-cms-automation";
export async function systemUserId(db: Queryable = getDbPool()): Promise<number | null> {
  const [rows] = await db.query<Row[]>("SELECT id FROM users WHERE login_id = ? AND is_system = TRUE", [SYSTEM_LOGIN_ID]);
  return rows[0] ? num(rows[0].id) : null;
}
export async function setTaskSourceForm(taskId: number, formId: number, db: Queryable): Promise<void> {
  await db.query<ResultSetHeader>("UPDATE tasks SET source_form_id = ? WHERE id = ?", [formId, taskId]);
}
