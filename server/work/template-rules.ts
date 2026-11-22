import { z } from "zod";
import { FIELD_TYPES, OPTION_TYPES, type FieldDef, type FieldType, type StoredValue } from "@/server/work/custom-fields";
import { daysBetween, FIELD_KINDS, shiftDays, templateSchema, type FieldKind, type ProjectTemplate, type TemplateTask } from "@/server/work/more-rules";

// v1.70.0 (D-383, PM phase E part 1, PM-B12): complete project templates.
// Pure and unit-tested. A template (and the JSON export, and a duplicate's
// working copy) is one shape, version 2:
//   project settings (description, colour, opens-on view, scheduling,
//   permissions), sections, custom fields of all 11 types with their options
//   (library fields by reference), assignee placeholders, tasks with
//   subtasks (dates as days from the project's start; every task has a due
//   date), dependencies (type + lag), saved tabs, dashboard widgets,
//   automations (drafts) and intake forms (drafts).
// Ids inside settings (fields, options, sections, forms) are the source
// project's; `remapRefs` turns them into the new project's ids.

export const TEMPLATE_VERSION = 2;
export const MAX_TEMPLATE_TASKS = 2000;
const PRIORITIES = ["LOW", "NORMAL", "ELEVATED", "IMPORTANT", "HIGH", "URGENT"] as const;
const DEP_TYPES = ["FS", "SS", "FF", "SF"] as const;
const offset = z.number().int().min(-3650).max(3650);
const key = z.string().regex(/^[A-Za-z0-9_-]{1,24}$/);

export const portableValueSchema = z.union([
  z.object({ text: z.string().max(500) }).strict(),
  z.object({ number: z.number().finite() }).strict(),
  z.object({ option: z.string().max(60) }).strict(),
  z.object({ options: z.array(z.string().max(60)).max(500) }).strict(),
  z.object({ dateOffset: offset, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable() }).strict(),
  z.object({ people: z.array(z.number().int().positive()).max(20) }).strict(),
  z.object({ tasks: z.array(key).max(20) }).strict(),
]);
export type PortableValue = z.infer<typeof portableValueSchema>;

export interface TemplateTaskV2 {
  key: string;
  title: string;
  description: string | null;
  priority: (typeof PRIORITIES)[number];
  section: number; // index into sections
  dueOffset: number; // days from the project's start (mandatory: every task has a due date)
  startOffset: number | null;
  isMilestone: boolean;
  tags: string[];
  assignee: string | null; // a placeholder key; null = whoever makes the project
  values: Record<string, PortableValue>; // field ref (source field id) → value
  subtasks: TemplateTaskV2[];
}
const taskSchema: z.ZodType<TemplateTaskV2> = z.lazy(() =>
  z.object({
    key,
    title: z.string().min(1).max(200),
    description: z.string().max(4000).nullable(),
    priority: z.enum(PRIORITIES),
    section: z.number().int().min(0).max(99),
    dueOffset: offset,
    startOffset: offset.nullable(),
    isMilestone: z.boolean(),
    tags: z.array(z.string().max(60)).max(20),
    assignee: key.nullable(),
    values: z.record(z.string().regex(/^\d{1,10}$/), portableValueSchema),
    subtasks: z.array(taskSchema).max(100),
  }),
);

export const templateFieldSchema = z.object({
  ref: z.number().int().positive(), // the source field id (what settings refer to)
  name: z.string().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  description: z.string().max(500).nullable().default(null),
  notify: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).default({}),
  idPrefix: z.string().max(12).nullable().default(null),
  library: z.boolean().default(false), // by reference: the library field is shown again, not copied
  showOnCards: z.boolean().default(true),
  options: z.array(z.object({ ref: z.number().int(), name: z.string().min(1).max(60), color: z.number().int().min(0).max(8), archived: z.boolean().default(false) })).max(1000).default([]),
});
export type TemplateField = z.infer<typeof templateFieldSchema>;

const projectSettingsSchema = z.object({
  description: z.string().max(10000).nullable().default(null),
  color: z.string().max(20).default("blue"),
  defaultView: z.string().max(20).default("LIST"),
  shiftMode: z.enum(["OFF", "KEEP_GAP", "CONSUME"]).default("OFF"),
  shiftSkipOffDays: z.boolean().default(true),
  statusReminder: z.boolean().default(false),
  permissions: z.unknown().default(null),
});
export const templateV2Schema = z.object({
  version: z.literal(2),
  project: projectSettingsSchema.default(() => projectSettingsSchema.parse({})),
  sections: z.array(z.object({ ref: z.number().int(), name: z.string().min(1).max(150) })).min(1).max(100),
  fields: z.array(templateFieldSchema).max(500).default([]),
  placeholders: z.array(z.object({ key, label: z.string().min(1).max(150), userId: z.number().int().positive().nullable() })).max(100).default([]),
  tasks: z.array(taskSchema).max(MAX_TEMPLATE_TASKS).default([]),
  dependencies: z.array(z.object({ predecessor: key, successor: key, type: z.enum(DEP_TYPES).default("FS"), lag: z.number().int().min(-365).max(365).default(0) })).max(5000).default([]),
  tabs: z.array(z.object({ type: z.string().max(20), name: z.string().min(1).max(60), config: z.unknown().default({}), isDefault: z.boolean().default(false) })).max(50).default([]),
  widgets: z.array(z.object({ kind: z.enum(["CHART", "TEXT"]), title: z.string().min(1).max(80), config: z.unknown().default(null), body: z.string().max(2000).nullable().default(null), size: z.enum(["HALF", "FULL"]).default("HALF") })).max(20).default([]),
  automations: z.array(z.object({ name: z.string().min(1).max(120), definition: z.unknown() })).max(100).default([]),
  forms: z.array(z.object({ ref: z.number().int().nullable().default(null), name: z.string().min(1).max(120), description: z.string().max(4000).nullable().default(null), draft: z.unknown(), settings: z.unknown(), coverPath: z.string().max(255).nullable().default(null), coverType: z.string().max(50).nullable().default(null) })).max(20).default([]),
});
export type TemplateV2 = z.infer<typeof templateV2Schema>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Any stored template (v1 from D-218, or v2), as v2. null: unreadable.
export function parseTemplateBody(raw: unknown): TemplateV2 | null {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (value && typeof value === "object" && (value as { version?: unknown }).version === 2) {
    const parsed = templateV2Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  const old = templateSchema.safeParse(value);
  return old.success ? upgradeV1(old.data) : null;
}

// A D-218 template as v2: fields by name become fields with made-up refs;
// a task without a due date is due on the start day (due dates are mandatory).
export function upgradeV1(old: ProjectTemplate): TemplateV2 {
  const fields: TemplateField[] = old.fields.map((field, index) => ({
    ref: index + 1,
    name: field.name,
    type: field.kind,
    description: null,
    notify: false,
    config: {},
    idPrefix: null,
    library: false,
    showOnCards: true,
    options: field.options.map((name, at) => ({ ref: -(at + 1), name, color: (at % 8) + 1, archived: false })),
  }));
  const refOf = new Map(fields.map((field) => [field.name, field]));
  let counter = 0;
  const convert = (task: TemplateTask): TemplateTaskV2 => {
    counter += 1;
    const values: Record<string, PortableValue> = {};
    for (const [name, raw] of Object.entries(task.fields)) {
      const field = refOf.get(name);
      if (!field || !raw) continue;
      if (field.type === "TEXT") values[String(field.ref)] = { text: raw.slice(0, 500) };
      else if (field.type === "NUMBER" && Number.isFinite(Number(raw))) values[String(field.ref)] = { number: Number(raw) };
      else if (field.type === "SELECT") values[String(field.ref)] = { option: raw };
      else if (field.type === "DATE" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) values[String(field.ref)] = { dateOffset: 0, time: null }; // v1 kept fixed dates; the start day is the nearest meaning
    }
    return {
      key: `t${counter}`,
      title: task.title,
      description: task.description,
      priority: task.priority,
      section: task.section,
      dueOffset: task.dueOffset ?? task.startOffset ?? 0,
      startOffset: task.startOffset,
      isMilestone: task.isMilestone,
      tags: task.tags,
      assignee: null,
      values,
      subtasks: task.subtasks.map(convert),
    };
  };
  return templateV2Schema.parse({ version: 2, sections: old.sections.map((name, index) => ({ ref: -(index + 1), name })), fields, tasks: old.tasks.map(convert) });
}

// A v2 template as the D-218 shape (screens and code with "pm_extras" off):
// the four old field types only, values as text.
export function legacyView(template: TemplateV2): ProjectTemplate {
  const legacy = template.fields.filter((field) => (FIELD_KINDS as readonly string[]).includes(field.type) && !field.library);
  const byRef = new Map(legacy.map((field) => [String(field.ref), field]));
  const text = (field: TemplateField, value: PortableValue): string | null => {
    if ("text" in value) return value.text;
    if ("number" in value) return String(value.number);
    if ("option" in value) return value.option;
    if ("dateOffset" in value) return null;
    return null;
  };
  const convert = (task: TemplateTaskV2): TemplateTask => ({
    title: task.title,
    description: task.description,
    priority: task.priority,
    section: task.section,
    dueOffset: task.dueOffset,
    startOffset: task.startOffset,
    isMilestone: task.isMilestone,
    tags: task.tags,
    fields: Object.fromEntries(
      Object.entries(task.values).flatMap(([ref, value]) => {
        const field = byRef.get(ref);
        const written = field ? text(field, value) : null;
        return field && written ? [[field.name, written]] : [];
      }),
    ),
    subtasks: task.subtasks.map(convert),
  });
  return {
    sections: template.sections.map((section) => section.name),
    fields: legacy.map((field) => ({ name: field.name, kind: field.type as FieldKind, options: field.options.filter((option) => !option.archived).map((option) => option.name) })),
    tasks: template.tasks.map(convert),
  };
}

export function countTasks(tasks: readonly TemplateTaskV2[]): number {
  return tasks.reduce((total, task) => total + 1 + countTasks(task.subtasks), 0);
}
export function allTasks(tasks: readonly TemplateTaskV2[]): TemplateTaskV2[] {
  return tasks.flatMap((task) => [task, ...allTasks(task.subtasks)]);
}
export interface TemplateSummary {
  tasks: number;
  sections: number;
  fields: number;
  dependencies: number;
  tabs: number;
  widgets: number;
  automations: number;
  forms: number;
  placeholders: number;
  days: number; // from the start to the last due date
}
export function templateSummary(template: TemplateV2): TemplateSummary {
  const tasks = allTasks(template.tasks);
  return {
    tasks: tasks.length,
    sections: template.sections.length,
    fields: template.fields.length,
    dependencies: template.dependencies.length,
    tabs: template.tabs.length,
    widgets: template.widgets.length,
    automations: template.automations.length,
    forms: template.forms.length,
    placeholders: template.placeholders.length,
    days: tasks.reduce((most, task) => Math.max(most, task.dueOffset), 0),
  };
}
// One line for a card: "3 tasks · 2 sections · …".
export function summaryLine(summary: TemplateSummary): string {
  const parts = [`${summary.tasks} task${summary.tasks === 1 ? "" : "s"}`, `${summary.sections} section${summary.sections === 1 ? "" : "s"}`];
  if (summary.fields) parts.push(`${summary.fields} field${summary.fields === 1 ? "" : "s"}`);
  if (summary.dependencies) parts.push(`${summary.dependencies} dependenc${summary.dependencies === 1 ? "y" : "ies"}`);
  if (summary.tabs) parts.push(`${summary.tabs} tab${summary.tabs === 1 ? "" : "s"}`);
  if (summary.widgets) parts.push(`${summary.widgets} dashboard chart${summary.widgets === 1 ? "" : "s"}`);
  if (summary.forms) parts.push(`${summary.forms} form${summary.forms === 1 ? "" : "s"}`);
  if (summary.automations) parts.push(`${summary.automations} automation${summary.automations === 1 ? "" : "s"}`);
  if (summary.days) parts.push(`${summary.days + 1} days long`);
  return parts.join(" · ");
}

// "Day 1" is the start day; days before it read "3 days before the start".
export function offsetLabel(days: number): string {
  if (days >= 0) return `Day ${days + 1}`;
  return `${-days} day${days === -1 ? "" : "s"} before the start`;
}

// ---- values -----------------------------------------------------------------------------
// A stored value as it travels in a template (option names, dates as days
// from the start, people by id, referenced tasks by template key). Computed
// or assigned types (formula, ID, lookup, timer) don't travel: they are
// worked out, numbered or started again in the new project.
export function toPortable(field: Pick<FieldDef, "type" | "options">, stored: StoredValue | null, start: string, keyOfTask: (taskId: number) => string | null): PortableValue | null {
  if (!stored) return null;
  switch (field.type) {
    case "TEXT":
      return stored.text ? { text: stored.text.slice(0, 500) } : null;
    case "NUMBER":
      return stored.number === null ? null : { number: stored.number };
    case "SELECT": {
      const option = field.options.find((item) => item.id === stored.optionId);
      return option ? { option: option.name } : null;
    }
    case "MULTI_SELECT": {
      const names = (stored.ids ?? []).map((id) => field.options.find((item) => item.id === id)?.name).filter((name): name is string => Boolean(name));
      return names.length ? { options: names } : null;
    }
    case "DATE":
      return stored.date ? { dateOffset: daysBetween(start, stored.date), time: stored.time } : null;
    case "PEOPLE":
      return stored.ids?.length ? { people: stored.ids.slice(0, 20) } : null;
    case "REFERENCE": {
      const keys = (stored.ids ?? []).map(keyOfTask).filter((item): item is string => item !== null);
      return keys.length ? { tasks: keys } : null;
    }
    default:
      return null;
  }
}
// What checkValue (custom-fields.ts) takes for this value in the new
// project's field (options by name), or undefined when it doesn't fit.
export function fromPortable(field: Pick<FieldDef, "type" | "options" | "config">, value: PortableValue, start: string, idOfTask: (key: string) => number | null): unknown {
  switch (field.type) {
    case "TEXT":
      return "text" in value ? value.text : undefined;
    case "NUMBER":
      return "number" in value ? value.number : undefined;
    case "SELECT": {
      if (!("option" in value)) return undefined;
      const option = field.options.find((item) => item.name.toLowerCase() === value.option.toLowerCase() && !item.archived);
      return option ? option.id : undefined;
    }
    case "MULTI_SELECT": {
      if (!("options" in value)) return undefined;
      const ids = value.options.map((name) => field.options.find((item) => item.name.toLowerCase() === name.toLowerCase())?.id).filter((id): id is number => id !== undefined);
      return ids.length ? ids : undefined;
    }
    case "DATE": {
      if (!("dateOffset" in value)) return undefined;
      const day = shiftDays(start, value.dateOffset);
      return field.config.withTime && value.time ? `${day}T${value.time}` : day;
    }
    case "PEOPLE":
      return "people" in value ? value.people : undefined;
    case "REFERENCE": {
      if (!("tasks" in value)) return undefined;
      const ids = value.tasks.map(idOfTask).filter((id): id is number => id !== null);
      return ids.length ? ids : undefined;
    }
    default:
      return undefined;
  }
}

// ---- references inside settings ---------------------------------------------------------
export interface IdMaps {
  fields: ReadonlyMap<number, number>;
  options: ReadonlyMap<number, number>;
  sections: ReadonlyMap<number, number>;
  forms: ReadonlyMap<number, number>;
  optionFields: ReadonlySet<number>; // source ids of single/multi-select fields
}
const FIELD_ID_KEYS = new Set(["fieldId", "referenceFieldId", "targetFieldId", "timerFieldId", "sortField", "groupField"]);
const DROP = Symbol("drop");
type Walked = unknown | typeof DROP;

function mapOption(value: unknown, maps: IdMaps): unknown {
  if (Array.isArray(value)) return value.map((item) => mapOption(item, maps)).filter((item) => item !== null);
  if (typeof value === "number") return maps.options.get(value) ?? null;
  if (typeof value === "string" && /^\d{1,10}$/.test(value)) {
    const mapped = maps.options.get(Number(value));
    return mapped === undefined ? "" : String(mapped);
  }
  return value;
}

function walk(value: unknown, maps: IdMaps): Walked {
  if (Array.isArray(value)) return value.map((item) => walk(item, maps)).filter((item) => item !== DROP);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let sourceField: number | null = null;
  let fieldLost = false;
  for (const [name, item] of Object.entries(source)) {
    if (FIELD_ID_KEYS.has(name) && typeof item === "number") {
      const mapped = maps.fields.get(item);
      if (name === "fieldId") {
        sourceField = item;
        if (mapped === undefined) fieldLost = true;
      }
      out[name] = mapped ?? null;
    } else if (name === "field" && typeof item === "string" && /^f\d{1,10}$/.test(item)) {
      const id = Number(item.slice(1));
      sourceField = id;
      const mapped = maps.fields.get(id);
      if (mapped === undefined) fieldLost = true;
      out[name] = mapped === undefined ? null : `f${mapped}`;
    } else if (name === "field" && typeof item === "string" && /^field:\d{1,10}$/.test(item)) {
      const mapped = maps.fields.get(Number(item.slice(6)));
      if (mapped === undefined) return DROP; // a permission rule on a field that didn't come along
      out[name] = `field:${mapped}`;
    } else if (name === "sectionId" && typeof item === "number") out[name] = maps.sections.get(item) ?? null;
    else if (name === "formId" && typeof item === "number") out[name] = maps.forms.get(item) ?? null;
    else if ((name === "hiddenFields" || name === "sections") && Array.isArray(item) && item.every((entry) => typeof entry === "number")) {
      const table = name === "hiddenFields" ? maps.fields : maps.sections;
      out[name] = (item as number[]).map((entry) => table.get(entry)).filter((entry): entry is number => entry !== undefined);
    } else if (name === "formula" && typeof item === "string") out[name] = item.replace(/\{f(\d{1,10})\}/g, (_, id: string) => `{f${maps.fields.get(Number(id)) ?? 0}}`);
    else {
      const walked = walk(item, maps);
      if (walked !== DROP) out[name] = walked; // a mapping on a field that didn't come along goes
    }
  }
  // A value that names an option of a select field, or a section.
  if ("value" in source) {
    if (sourceField !== null && maps.optionFields.has(sourceField)) out.value = mapOption(source.value, maps);
    else if (source.subject === "SECTION") out.value = mapOption(source.value, { ...maps, options: maps.sections });
  }
  // A filter on a field that didn't come along goes; a mapping to such a field goes.
  if (fieldLost && "op" in source && !("subject" in source)) return DROP;
  if (fieldLost && source.kind === "FIELD") return DROP;
  return out;
}
// The same settings with the new project's ids. Ids that have no
// counterpart become null (or the entry goes, for filters and mappings);
// the builders then show what needs choosing again.
export function remapRefs<T>(value: T, maps: IdMaps): T {
  const walked = walk(value, maps);
  return (walked === DROP ? null : walked) as T;
}

// ---- duplicate ------------------------------------------------------------------------------
export const DUPLICATE_PARTS = ["tasks", "subtasks", "assignees", "dueDates", "fields", "dependencies", "tabs", "dashboard", "forms", "automations", "members", "statusUpdates"] as const;
export type DuplicatePart = (typeof DUPLICATE_PARTS)[number];
export const DUPLICATE_PART_LABEL: Record<DuplicatePart, string> = {
  tasks: "Tasks",
  subtasks: "Subtasks",
  assignees: "Assignees",
  dueDates: "Due dates",
  fields: "Custom fields and their values",
  dependencies: "Dependencies",
  tabs: "Saved tabs",
  dashboard: "Dashboard",
  forms: "Forms (as unpublished drafts)",
  automations: "Automations (as drafts, owned by you)",
  members: "Members",
  statusUpdates: "Status updates",
};
// Spec: everything on except status updates.
export const DEFAULT_DUPLICATE: Record<DuplicatePart, boolean> = { tasks: true, subtasks: true, assignees: true, dueDates: true, fields: true, dependencies: true, tabs: true, dashboard: true, forms: true, automations: true, members: true, statusUpdates: false };
export interface DuplicateChoice {
  parts: Record<DuplicatePart, boolean>;
  shiftDays: number; // move every date by this many days
}
// Parts that need another one: subtasks, assignees, due dates and
// dependencies only make sense with tasks; dependencies need tasks.
export function readDuplicateChoice(raw: { parts?: Partial<Record<string, unknown>>; shiftDays?: unknown }): DuplicateChoice {
  const parts = Object.fromEntries(DUPLICATE_PARTS.map((part) => [part, raw.parts?.[part] === undefined ? DEFAULT_DUPLICATE[part] : raw.parts[part] === true || raw.parts[part] === "on"])) as Record<DuplicatePart, boolean>;
  if (!parts.tasks) {
    parts.subtasks = false;
    parts.assignees = false;
    parts.dependencies = false;
  }
  const shift = Number(raw.shiftDays ?? 0);
  return { parts, shiftDays: Number.isInteger(shift) && Math.abs(shift) <= 3650 ? shift : 0 };
}

// Trims a captured shape to the chosen parts (fields off also drops values;
// due dates off keeps them mandatory: every task becomes due on the start day).
export function applyChoice(template: TemplateV2, choice: DuplicateChoice): TemplateV2 {
  const { parts } = choice;
  const trimTask = (task: TemplateTaskV2): TemplateTaskV2 => ({
    ...task,
    dueOffset: parts.dueDates ? task.dueOffset : 0,
    startOffset: parts.dueDates ? task.startOffset : null,
    assignee: parts.assignees ? task.assignee : null,
    values: parts.fields ? task.values : {},
    subtasks: parts.subtasks ? task.subtasks.map(trimTask) : [],
  });
  const tasks = parts.tasks ? template.tasks.map(trimTask) : [];
  const keys = new Set(allTasks(tasks).map((task) => task.key));
  return {
    ...template,
    fields: parts.fields ? template.fields : [],
    placeholders: parts.assignees ? template.placeholders : [],
    tasks,
    dependencies: parts.dependencies ? template.dependencies.filter((link) => keys.has(link.predecessor) && keys.has(link.successor)) : [],
    tabs: parts.tabs ? template.tabs : [],
    widgets: parts.dashboard ? template.widgets : [],
    automations: parts.automations ? template.automations : [],
    forms: parts.forms ? template.forms : [],
  };
}

export const isOptionType = (type: FieldType) => OPTION_TYPES.includes(type);

// Any stored template in the D-218 shape (for the screens with "pm_extras" off).
export function readLegacyTemplate(raw: unknown): ProjectTemplate | null {
  const body = parseTemplateBody(raw);
  return body ? legacyView(body) : null;
}
