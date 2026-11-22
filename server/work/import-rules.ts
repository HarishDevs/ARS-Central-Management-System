import { checkValue, READ_ONLY_TYPES, type FieldDef } from "@/server/work/custom-fields";
import { PRIORITY_LABEL, TASK_PRIORITIES, type TaskPriority } from "@/server/modules/settings";

// v1.70.0 (D-383, PM phase E part 1): importing tasks into a project from a
// CSV or Excel file. Pure and unit-tested: guessing which column is what,
// reading dates, people and priorities, and checking each row (the dry run).
// The service (project-io.ts) reads the upload, checks rights and creates
// the tasks through the normal task rules.

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_COLUMNS = 60;
export const IMPORTS_PER_HOUR = 10;
export const MAX_NEW_SECTIONS = 20;
export const TASK_TARGETS = ["title", "description", "section", "assignee", "due", "priority"] as const;
export type TaskTarget = (typeof TASK_TARGETS)[number];
export const TARGET_LABEL: Record<TaskTarget, string> = { title: "Task name", description: "Description", section: "Section", assignee: "Assignee (name, email or User ID)", due: "Due date", priority: "Priority" };
export type Target = TaskTarget | `field:${number}` | "skip";
export const isTarget = (value: unknown): value is Target => typeof value === "string" && (value === "skip" || (TASK_TARGETS as readonly string[]).includes(value) || /^field:\d{1,10}$/.test(value));

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const GUESSES: Record<TaskTarget, string[]> = {
  title: ["name", "task", "task name", "title", "subject"],
  description: ["description", "details", "notes", "note"],
  section: ["section", "column", "group", "list"],
  assignee: ["assignee", "assigned to", "owner", "person", "who", "assignee email", "responsible"],
  due: ["due", "due date", "due on", "deadline", "target date"],
  priority: ["priority"],
};
// A first guess for each column (each target at most once; a field by its name).
export function guessMapping(header: readonly string[], fields: readonly Pick<FieldDef, "id" | "name" | "type">[]): Target[] {
  const used = new Set<string>();
  return header.map((raw) => {
    const name = norm(raw);
    for (const target of TASK_TARGETS) {
      if (!used.has(target) && GUESSES[target].includes(name)) {
        used.add(target);
        return target;
      }
    }
    const field = fields.find((item) => !READ_ONLY_TYPES.includes(item.type) && item.type !== "TIMER" && item.type !== "REFERENCE" && norm(item.name) === name && !used.has(`field:${item.id}`));
    if (field) {
      used.add(`field:${field.id}`);
      return `field:${field.id}` as Target;
    }
    return "skip";
  });
}
// Fields a column can fill (typed values; not worked-out, timer or reference fields).
export const importableField = (field: Pick<FieldDef, "type">) => !READ_ONLY_TYPES.includes(field.type) && field.type !== "TIMER" && field.type !== "REFERENCE";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const valid = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const year = (text: string) => (text.length === 2 ? 2000 + Number(text) : Number(text));
// A day as YYYY-MM-DD from what people type in India and what Excel writes:
// 2026-12-15, 15/12/2026, 15-12-26, 15.12.2026 (day first), 15 Dec 2026,
// 15-Dec-26, Dec 15, 2026, or an Excel day number (46371). null: not a date.
export function parseDay(raw: string): string | null {
  const text = raw.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (match) return valid(+match[1]!, +match[2]!, +match[3]!) ? iso(+match[1]!, +match[2]!, +match[3]!) : null;
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (match) return valid(year(match[3]!), +match[2]!, +match[1]!) ? iso(year(match[3]!), +match[2]!, +match[1]!) : null;
  match = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{2}|\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[2]!.slice(0, 3).toLowerCase()) + 1;
    return month && valid(year(match[3]!), month, +match[1]!) ? iso(year(match[3]!), month, +match[1]!) : null;
  }
  match = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (match) {
    const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase()) + 1;
    return month && valid(+match[3]!, month, +match[2]!) ? iso(+match[3]!, month, +match[2]!) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial < 20000 || serial > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  return null;
}

export function parsePriority(raw: string): TaskPriority | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const byLabel = (Object.entries(PRIORITY_LABEL) as [TaskPriority, string][]).find(([, label]) => label.toLowerCase() === text);
  if (byLabel && (TASK_PRIORITIES as readonly string[]).includes(byLabel[0])) return byLabel[0];
  const byCode = TASK_PRIORITIES.find((code) => code.toLowerCase() === text);
  return byCode ?? null;
}

export interface PersonRef {
  id: number;
  name: string;
  email: string | null;
  loginId: string;
}
// One active person by email, User ID or exact name ("Name - Code" too).
export function matchPerson(raw: string, people: readonly PersonRef[]): { id: number; name: string } | { error: string } {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const byKey = people.find((person) => (person.email && person.email.toLowerCase() === lower) || person.loginId.toLowerCase() === lower || `${person.name} - ${person.loginId}`.toLowerCase() === lower);
  if (byKey) return { id: byKey.id, name: byKey.name };
  const byName = people.filter((person) => person.name.toLowerCase() === lower);
  if (byName.length === 1) return { id: byName[0]!.id, name: byName[0]!.name };
  if (byName.length > 1) return { error: `More than one person is called “${text}”; use their email or User ID.` };
  return { error: `No active person “${text}”.` };
}

export interface PlanRow {
  line: number; // in the file (header = 1)
  title: string;
  description: string | null;
  section: string | null; // null: the project's first section
  newSection: boolean;
  assigneeId: number | null; // null: the person importing
  assigneeName: string | null;
  dueDay: string | null;
  priority: TaskPriority | null;
  values: { fieldId: number; value: unknown }[];
  errors: string[];
}
export interface ImportPlan {
  rows: PlanRow[];
  newSections: string[];
  ready: number;
  withErrors: number;
  problems: string[]; // problems with the whole file or mapping
}
export interface PlanInput {
  header: string[];
  rows: { line: number; cells: string[] }[];
  mapping: Target[];
  fields: readonly FieldDef[];
  people: readonly PersonRef[];
  sections: readonly string[];
}
const splitList = (text: string) => text.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);

export function planImport(input: PlanInput): ImportPlan {
  const problems: string[] = [];
  if (input.header.length > IMPORT_MAX_COLUMNS) problems.push(`The file has ${input.header.length} columns; at most ${IMPORT_MAX_COLUMNS}.`);
  if (input.rows.length > IMPORT_MAX_ROWS) problems.push(`The file has ${input.rows.length} rows; at most ${IMPORT_MAX_ROWS} in one import. Split it into smaller files.`);
  if (!input.mapping.includes("title")) problems.push("Choose the column with the task name.");
  if (!input.mapping.includes("due")) problems.push("Choose the column with the due date (every task needs one).");
  const seen = new Set<string>();
  for (const target of input.mapping) {
    if (target === "skip") continue;
    if (seen.has(target)) problems.push(`Two columns are set to ${target.startsWith("field:") ? (input.fields.find((field) => `field:${field.id}` === target)?.name ?? "the same field") : TARGET_LABEL[target as TaskTarget]}.`);
    seen.add(target);
    if (target.startsWith("field:") && !input.fields.some((field) => `field:${field.id}` === target && importableField(field))) problems.push("A column is set to a field this project doesn't have (or that can't be typed).");
  }
  const existing = new Map(input.sections.map((name) => [name.toLowerCase(), name]));
  const newSections: string[] = [];
  const rows: PlanRow[] = [];
  for (const row of input.rows.slice(0, IMPORT_MAX_ROWS)) {
    if (row.cells.every((cell) => !cell.trim())) continue;
    const cell = (target: Target) => {
      const index = input.mapping.indexOf(target);
      return index >= 0 ? (row.cells[index] ?? "").trim() : "";
    };
    const errors: string[] = [];
    const title = cell("title").replace(/\s+/g, " ");
    if (!title) errors.push("The task name is empty.");
    else if (title.length > 200) errors.push("The task name is longer than 200 characters.");
    const description = cell("description").slice(0, 4000) || null;
    let section: string | null = null;
    let newSection = false;
    const sectionText = cell("section").replace(/\s+/g, " ").slice(0, 150);
    if (sectionText) {
      const known = existing.get(sectionText.toLowerCase()) ?? newSections.find((name) => name.toLowerCase() === sectionText.toLowerCase());
      if (known) {
        section = known;
        newSection = newSections.includes(known);
      } else if (newSections.length >= MAX_NEW_SECTIONS) errors.push(`At most ${MAX_NEW_SECTIONS} new sections in one import.`);
      else {
        newSections.push(sectionText);
        section = sectionText;
        newSection = true;
      }
    }
    let assigneeId: number | null = null;
    let assigneeName: string | null = null;
    const who = cell("assignee");
    if (who) {
      const found = matchPerson(who, input.people);
      if ("error" in found) errors.push(found.error);
      else {
        assigneeId = found.id;
        assigneeName = found.name;
      }
    }
    const dueText = cell("due");
    const dueDay = dueText ? parseDay(dueText) : null;
    if (!dueText) errors.push("The due date is empty (every task needs one).");
    else if (!dueDay) errors.push(`“${dueText}” isn't a date (use 15/12/2026 or 2026-12-15).`);
    const priorityText = cell("priority");
    const priority = priorityText ? parsePriority(priorityText) : null;
    if (priorityText && !priority) errors.push(`“${priorityText}” isn't a priority (${TASK_PRIORITIES.map((code) => PRIORITY_LABEL[code]).join(", ")}).`);
    const values: PlanRow["values"] = [];
    input.mapping.forEach((target, index) => {
      if (!target.startsWith("field:")) return;
      const field = input.fields.find((item) => `field:${item.id}` === target);
      const text = (row.cells[index] ?? "").trim();
      if (!field || !text || !importableField(field)) return;
      let raw: unknown = text;
      if (field.type === "MULTI_SELECT") {
        const ids: number[] = [];
        for (const name of splitList(text)) {
          const option = field.options.find((item) => item.name.toLowerCase() === name.toLowerCase() && !item.archived);
          if (option) ids.push(option.id);
          else errors.push(`${field.name}: “${name}” isn't one of its options.`);
        }
        raw = ids;
      } else if (field.type === "SELECT") {
        const option = field.options.find((item) => item.name.toLowerCase() === text.toLowerCase());
        raw = option ? option.id : text;
      } else if (field.type === "DATE") {
        const day = parseDay(text);
        if (!day) {
          errors.push(`${field.name}: “${text}” isn't a date.`);
          return;
        }
        raw = day;
      } else if (field.type === "PEOPLE") {
        const ids: number[] = [];
        for (const name of splitList(text)) {
          const found = matchPerson(name, input.people);
          if ("error" in found) errors.push(`${field.name}: ${found.error}`);
          else ids.push(found.id);
        }
        raw = ids;
      }
      const checked = checkValue(field, raw);
      if (!checked.ok) errors.push(`${field.name}: ${checked.message}`);
      else if (checked.stored) values.push({ fieldId: field.id, value: raw });
    });
    rows.push({ line: row.line, title, description, section, newSection, assigneeId, assigneeName, dueDay, priority, values, errors });
  }
  if (!rows.length && !problems.length) problems.push("The file has no rows below the header.");
  const withErrors = rows.filter((row) => row.errors.length).length;
  return { rows, newSections: newSections.filter((name) => rows.some((row) => row.section === name && !row.errors.length)), ready: rows.length - withErrors, withErrors, problems };
}
