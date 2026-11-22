import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { hitRateLimit } from "@/lib/db/repositories/jobs.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as fieldsRepo from "@/lib/db/repositories/fields.repository";
import { toCsv, parseCsv } from "@/server/import/csv";
import { buildWorkbook } from "@/server/import/xlsx";
import { readUpload } from "@/server/import/service";
import { PRIORITY_LABEL } from "@/server/modules/settings";
import { TASK_STATUS_LABEL } from "@/server/modules/task-rules";
import type { TaskActor } from "@/server/modules/tasks";
import { indiaDate } from "@/server/workflows/calendar";
import { projectAbilities } from "@/server/work/access";
import { cellsFor, setFieldValue } from "@/server/work/fields-service";
import { guessMapping, importableField, IMPORTS_PER_HOUR, isTarget, planImport, type ImportPlan, type PersonRef, type Target } from "@/server/work/import-rules";
import { workViewer } from "@/server/work/task-access";
import { extrasOn } from "@/server/work/templates";
import * as work from "@/server/work/service";

// v1.70.0 (D-383, PM phase E part 1): export a project (CSV and Excel: the
// List's columns with custom fields; JSON: the full structure, see
// templates.ts projectJson) and import tasks from CSV or Excel with a
// column mapping, a dry run and a row-by-row report. Behind "pm_extras".
// Export: anyone who sees the project (only what they may see). Import:
// owners and editors; the file is checked like every import upload (2 MB,
// .xlsx/.csv); at most 500 rows and 10 imports an hour per person; every task
// goes through the normal task rules (assignee rules, mandatory due date).
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string };
type Row = RowDataPacket & Record<string, unknown>;
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const NOT_FOUND = "Not found.";
const OFF = "This isn't switched on yet (Super Admin → Features → Projects E).";

// ---- export -------------------------------------------------------------------------------
export interface ExportTable {
  projectName: string;
  header: string[];
  rows: string[][];
}
export async function exportTable(projectId: number, actor: TaskActor): Promise<Result<ExportTable>> {
  if (!(await extrasOn(actor))) return fail(OFF);
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate) return fail(NOT_FOUND);
  const sections = new Map((await repo.listSections(projectId)).map((section) => [section.id, section.name]));
  const top = await repo.listProjectTasks(projectId);
  const all: repo.WorkTaskItem[] = [];
  const children = new Map<number, repo.WorkTaskItem[]>();
  let level = top.map((task) => task.id);
  for (let depth = 0; depth < 5 && level.length; depth += 1) {
    const found = await repo.listChildTasks(level);
    for (const child of found) children.set(child.parentTaskId!, [...(children.get(child.parentTaskId!) ?? []), child]);
    level = found.map((child) => child.id);
  }
  const sectionOf = new Map<number, number | null>();
  const walk = (task: repo.WorkTaskItem, section: number | null) => {
    all.push(task);
    sectionOf.set(task.id, section);
    for (const child of children.get(task.id) ?? []) walk(child, section);
  };
  for (const task of top.filter((item) => item.parentTaskId === null)) walk(task, task.sectionId);
  const ids = all.map((task) => task.id);
  const taskNo = new Map(all.map((task) => [task.id, task.taskNo]));
  const [extra] = ids.length ? await getDbPool().query<Row[]>("SELECT t.id, t.description, u.email FROM tasks t JOIN users u ON u.id = t.assignee_id WHERE t.id IN (?)", [ids]) : [[] as Row[]];
  const details = new Map(extra.map((row) => [Number(row.id), { description: row.description === null ? "" : String(row.description), email: row.email === null ? "" : String(row.email) }]));
  const defs = await fieldsRepo.listFieldDefs(projectId);
  const cells = await cellsFor(ids, defs, { ...viewer, id: actor.id });
  const header = ["Task ID", "Name", "Section", "Assignee", "Assignee email", "Due date", "Start date", "Priority", "Status", "Completed on", "Parent task", "Tags", "Description", ...defs.map((field) => field.name)];
  const rows = all.map((task) => [
    task.taskNo,
    task.title,
    sections.get(sectionOf.get(task.id) ?? -1) ?? "",
    task.assigneeName,
    details.get(task.id)?.email ?? "",
    task.dueAt ? indiaDate(task.dueAt) : "",
    task.startsOn ?? "",
    PRIORITY_LABEL[task.priority] ?? task.priority,
    TASK_STATUS_LABEL[task.status] ?? task.status,
    task.completedAt ? indiaDate(task.completedAt) : "",
    task.parentTaskId ? (taskNo.get(task.parentTaskId) ?? "") : "",
    task.tags.map((tag) => tag.name).join(", "),
    details.get(task.id)?.description ?? "",
    ...defs.map((field) => cells[task.id]?.[field.id]?.text ?? ""),
  ]);
  await recordAudit({ actorUserId: actor.id, action: "PROJECT_EXPORTED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { rows: rows.length } });
  return { ok: true, value: { projectName: found.project.name, header, rows } };
}
export const exportCsv = (table: ExportTable) => toCsv(table.header, table.rows);
export const exportXlsx = (table: ExportTable) => buildWorkbook([{ name: table.projectName.slice(0, 31) || "Tasks", header: table.header, rows: table.rows }]);
export const exportFileName = (name: string, extension: string, at = new Date()) => `${name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "project"}-${indiaDate(at)}.${extension}`;

// ---- import -------------------------------------------------------------------------------
async function importAccess(projectId: number, actor: TaskActor) {
  if (!(await extrasOn(actor))) return { error: OFF };
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate) return { error: NOT_FOUND };
  if (!projectAbilities(found.role).edit) return { error: "Only the project's owners and editors can import tasks into it." };
  return { found };
}
async function activePeople(): Promise<PersonRef[]> {
  const [rows] = await getDbPool().query<Row[]>("SELECT id, name, email, login_id FROM users WHERE active = TRUE AND is_system = FALSE AND is_break_glass = FALSE LIMIT 5000");
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), email: row.email === null ? null : String(row.email), loginId: String(row.login_id) }));
}

export interface ImportPreview {
  fileName: string;
  header: string[];
  sample: string[][]; // the first rows, to help choose
  mapping: Target[]; // as given, or guessed
  fields: { id: number; name: string; type: string }[]; // fields a column can fill
  plan: ImportPlan | null; // with a mapping: the dry run
}
function readMapping(raw: unknown, columns: number): Target[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== columns || !parsed.every(isTarget)) return null;
    return parsed as Target[];
  } catch {
    return null;
  }
}

// Step 1 (no mapping): the columns and a guess. Step 2 (a mapping): the dry run.
export async function previewImport(projectId: number, formData: FormData, actor: TaskActor): Promise<Result<ImportPreview>> {
  const access = await importAccess(projectId, actor);
  if ("error" in access) return fail(access.error!);
  const upload = await readUpload(formData.get("file"));
  if (!upload.ok) return upload;
  const parsed = parseCsv(upload.text);
  if (!parsed.header.length) return fail("The file has no header row.");
  const defs = await fieldsRepo.listFieldDefs(projectId);
  const mapping = readMapping(formData.get("mapping"), parsed.header.length);
  const plan = mapping ? planImport({ header: parsed.header, rows: parsed.rows, mapping, fields: defs, people: await activePeople(), sections: (await repo.listSections(projectId)).map((section) => section.name) }) : null;
  return {
    ok: true,
    value: {
      fileName: upload.name,
      header: parsed.header,
      sample: parsed.rows.slice(0, 3).map((row) => row.cells),
      mapping: mapping ?? guessMapping(parsed.header, defs),
      fields: defs.filter(importableField).map((field) => ({ id: field.id, name: field.name, type: field.type })),
      plan,
    },
  };
}

export interface ImportOutcome {
  created: number;
  failed: { line: number; message: string }[];
  skipped: number; // rows with problems in the dry run, left out
}
// Step 3: import the rows without problems (with "skip rows with problems"
// ticked; otherwise every row must be ready).
export async function runImport(projectId: number, formData: FormData, actor: TaskActor): Promise<Result<ImportOutcome>> {
  const access = await importAccess(projectId, actor);
  if ("error" in access) return fail(access.error!);
  const upload = await readUpload(formData.get("file"));
  if (!upload.ok) return upload;
  const parsed = parseCsv(upload.text);
  const mapping = readMapping(formData.get("mapping"), parsed.header.length);
  if (!mapping) return fail("Choose what each column is first.");
  const defs = await fieldsRepo.listFieldDefs(projectId);
  const sections = await repo.listSections(projectId);
  const plan = planImport({ header: parsed.header, rows: parsed.rows, mapping, fields: defs, people: await activePeople(), sections: sections.map((section) => section.name) });
  if (plan.problems.length) return fail(plan.problems[0]!);
  const skipBad = formData.get("skipErrors") === "on" || formData.get("skipErrors") === "true";
  if (plan.withErrors && !skipBad) return fail(`${plan.withErrors} row${plan.withErrors === 1 ? " has" : "s have"} problems. Fix the file, or tick "Skip rows with problems".`);
  if (!plan.ready) return fail("No row is ready to import.");
  if ((await hitRateLimit(`pm-import:${actor.id}`, 3600).catch(() => 0)) > IMPORTS_PER_HOUR) return fail(`At most ${IMPORTS_PER_HOUR} imports an hour. Try again later.`);
  // New sections first (at the end of the project).
  const sectionIds = new Map(sections.map((section) => [section.name.toLowerCase(), section.id]));
  if (plan.newSections.length) {
    await withTransaction(async (connection) => {
      let position = (sections.at(-1)?.position ?? 0) + 1024;
      for (const name of plan.newSections) {
        sectionIds.set(name.toLowerCase(), await repo.insertSection(projectId, name, position, actor.id, connection));
        await repo.appendProjectEvent(projectId, actor.id, "SECTION_ADDED", name, connection);
        position += 1024;
      }
    });
  }
  const outcome: ImportOutcome = { created: 0, failed: [], skipped: plan.withErrors };
  for (const row of plan.rows) {
    if (row.errors.length) continue;
    const added = await work.quickAddTask(
      {
        title: row.title,
        projectId,
        sectionId: row.section ? (sectionIds.get(row.section.toLowerCase()) ?? null) : null,
        parentId: null,
        assigneeId: row.assigneeId,
        dueDay: row.dueDay ?? "",
        mySectionId: null,
        description: row.description ?? undefined,
        priority: row.priority ?? undefined,
        holidayOk: true, // a date in the file is kept even on a holiday (the report says so)
      },
      actor,
    );
    if (!added.ok) {
      outcome.failed.push({ line: row.line, message: added.message });
      continue;
    }
    outcome.created += 1;
    for (const value of row.values) {
      const set = await setFieldValue(added.value.id, value.fieldId, value.value, actor);
      if (!set.ok) outcome.failed.push({ line: row.line, message: `Task made, but ${set.message}` });
    }
  }
  await recordAudit({ actorUserId: actor.id, action: "PROJECT_IMPORTED", entityType: "PROJECT", entityId: projectId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { file: upload.name, created: outcome.created, failed: outcome.failed.length, skipped: outcome.skipped } });
  return { ok: true, value: outcome, message: `${outcome.created} task${outcome.created === 1 ? "" : "s"} imported${outcome.skipped ? `; ${outcome.skipped} row${outcome.skipped === 1 ? "" : "s"} with problems left out` : ""}${outcome.failed.length ? `; ${outcome.failed.length} problem${outcome.failed.length === 1 ? "" : "s"} while importing` : ""}.` };
}
