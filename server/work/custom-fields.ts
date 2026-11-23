import { z } from "zod";
import { compareValues } from "@/server/lists/sorting";
import { analyseFormula, dayNumber, dayOf, evaluateFormula, FORMULA_ERROR_TEXT, formulaFields, parseFormula, type Builtin, type FormulaAnalysis, type FormulaResult, type FxField } from "@/server/work/formula";
import type { WorkCalendar } from "@/server/work/schedule";

// v1.64.0 (D-371, PM phase B part 1, spec PROJECTS_CUSTOMIZATION §8): custom
// fields with eleven types. Pure and unit-tested: types and labels, per-type
// settings, number and timer formatting, checking a value before it is
// stored, turning stored values into cells (display text and sort key),
// filters, groups, the limits and who may change a field. The repository
// stores (fields.repository.ts), the service checks rights (fields-service.ts).

export const FIELD_TYPES = ["TEXT", "NUMBER", "SELECT", "MULTI_SELECT", "DATE", "PEOPLE", "FORMULA", "ID", "TIMER", "REFERENCE", "LOOKUP"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const isFieldType = (value: unknown): value is FieldType => typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  SELECT: "Single-select",
  MULTI_SELECT: "Multi-select",
  DATE: "Date",
  PEOPLE: "People",
  FORMULA: "Formula",
  ID: "ID",
  TIMER: "Timer",
  REFERENCE: "Reference",
  LOOKUP: "Lookup",
};
export const FIELD_TYPE_HELP: Record<FieldType, string> = {
  TEXT: "Notes, names, vendors",
  NUMBER: "Amounts, percentages, quantities",
  SELECT: "Stage, priority, effort: one choice",
  MULTI_SELECT: "Plants, activities: several choices",
  DATE: "Review dates, milestones",
  PEOPLE: "Reviewers, stakeholders",
  FORMULA: "Worked out from number and date fields",
  ID: "A number for every task, like PO-12",
  TIMER: "Time spent, started and stopped",
  REFERENCE: "Links to other tasks",
  LOOKUP: "A value from a linked task",
};
// BR-PROJ-073: "Notify collaborators" is offered for these types only.
export const NOTIFY_TYPES: readonly FieldType[] = ["SELECT", "MULTI_SELECT", "DATE", "PEOPLE", "REFERENCE"];
// BR-PROJ-076: computed or assigned values nobody types.
export const READ_ONLY_TYPES: readonly FieldType[] = ["FORMULA", "ID", "LOOKUP"];
export const OPTION_TYPES: readonly FieldType[] = ["SELECT", "MULTI_SELECT"];
// The four types of v1.63 (shown when the "pm_planning" switch is off).
export const LEGACY_TYPES: readonly FieldType[] = ["TEXT", "NUMBER", "SELECT", "DATE"];

export const FIELD_NAME_MAX = 60;
export const OPTION_NAME_MAX = 60;
export const TEXT_VALUE_MAX = 500;
export const MAX_PEOPLE = 20;
export const MAX_REFERENCES = 20;
export const ID_PREFIX = /^[A-Z][A-Z0-9]{0,9}$/;

// ---- per-type settings --------------------------------------------------------------
export const NUMBER_FORMATS = ["plain", "percent", "currency", "unit"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const NUMBER_FORMAT_LABEL: Record<NumberFormat, string> = { plain: "Number", percent: "Percent", currency: "Currency", unit: "Custom unit" };
export const fieldConfigSchema = z.object({
  format: z.enum(NUMBER_FORMATS).default("plain"),
  decimals: z.number().int().min(0).max(6).default(0),
  symbol: z.string().trim().max(5).default("₹"), // currency
  unit: z.string().trim().max(12).default(""), // custom unit
  unitBefore: z.boolean().default(false),
  withTime: z.boolean().default(false), // date
  formula: z.string().max(1000).default(""), // {f12} + {f15}; v1.88: + functions and {due} etc. (500 as people read it, D-418)
  referenceFieldId: z.number().int().positive().nullable().default(null), // lookup
  targetFieldId: z.number().int().positive().nullable().default(null), // lookup
});
export type FieldConfig = z.infer<typeof fieldConfigSchema>;
export const DEFAULT_CONFIG: FieldConfig = fieldConfigSchema.parse({});
export function parseFieldConfig(raw: unknown): FieldConfig {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = {};
    }
  }
  const parsed = fieldConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_CONFIG;
}

// ---- formatting ---------------------------------------------------------------------
// AC-PROJC-07: 1234.5 with 2 decimals reads "1,234.50" (Indian grouping for lakhs).
export function formatNumber(value: number, config: Pick<FieldConfig, "format" | "decimals" | "symbol" | "unit" | "unitBefore">): string {
  const text = value.toLocaleString("en-IN", { minimumFractionDigits: config.decimals, maximumFractionDigits: config.decimals });
  switch (config.format) {
    case "percent":
      return `${text}%`;
    case "currency":
      return value < 0 ? `-${config.symbol || "₹"}${text.slice(1)}` : `${config.symbol || "₹"}${text}`;
    case "unit":
      return config.unit ? (config.unitBefore ? `${config.unit} ${text}` : `${text} ${config.unit}`) : text;
    default:
      return text;
  }
}
// Timer: accumulated time as h:mm ("0:05", "12:30").
export function timerText(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
export const idText = (prefix: string, n: number) => `${prefix}-${n}`;
export function cleanIdPrefix(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return ID_PREFIX.test(value) ? value : null;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateText(day: string, time: string | null): string {
  const [y, m, d] = day.split("-").map(Number);
  const text = `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
  return time ? `${text}, ${time.slice(0, 5)}` : text;
}
// Days since 1 Jan 1970 (dates in formulas).
export { dayNumber };

// ---- names and options ------------------------------------------------------------------
export const cleanName = (raw: unknown, max = FIELD_NAME_MAX) => (typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
export interface OptionInput {
  id?: number | null;
  name: string;
  color: number;
  archived?: boolean;
}
export const optionInputSchema = z.object({
  id: z.number().int().positive().nullable().optional(),
  name: z.string().max(200),
  color: z.number().int().min(0).max(8).default(0),
  archived: z.boolean().optional(),
});
// Options for a select field: names folded, empty ones dropped, no repeats
// (case-insensitive); at most `max`. Returns a message when something's wrong.
export function cleanOptions(raw: readonly OptionInput[], max: number): { ok: true; options: OptionInput[] } | { ok: false; message: string } {
  const out: OptionInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = cleanName(item.name, OPTION_NAME_MAX);
    if (!name) continue;
    if (seen.has(name.toLowerCase())) return { ok: false, message: `The option “${name}” is listed twice.` };
    seen.add(name.toLowerCase());
    out.push({ id: item.id ?? null, name, color: Math.min(8, Math.max(0, Math.round(item.color || 0))), archived: Boolean(item.archived) });
  }
  if (!out.some((item) => !item.archived)) return { ok: false, message: "Add at least one option." };
  if (out.length > max) return { ok: false, message: `A field has at most ${max} options.` };
  return { ok: true, options: out };
}

// ---- limits (C-8: Admin settings, defaults from the spec) ----------------------------
export const FIELD_LIMITS_KEY = "tasks.field_limits";
export const fieldLimitsSchema = z.object({
  perProject: z.number().int().min(1).max(500).default(150),
  perTask: z.number().int().min(1).max(200).default(60),
  options: z.number().int().min(2).max(1000).default(500),
});
export type FieldLimits = z.infer<typeof fieldLimitsSchema>;
export const DEFAULT_FIELD_LIMITS: FieldLimits = fieldLimitsSchema.parse({});
export function parseFieldLimits(raw: string | null | undefined): FieldLimits {
  try {
    const parsed = fieldLimitsSchema.safeParse(raw ? JSON.parse(raw) : {});
    return parsed.success ? parsed.data : DEFAULT_FIELD_LIMITS;
  } catch {
    return DEFAULT_FIELD_LIMITS;
  }
}

// ---- who may change fields ----------------------------------------------------------------
// "Only admins customise" (project permissions): OWNER = project admins only.
export type CustomiseRole = "EDITOR" | "OWNER";
type Role = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER" | null;
const RANK: Record<NonNullable<Role>, number> = { OWNER: 4, EDITOR: 3, COMMENTER: 2, VIEWER: 1 };
// May this person add, remove or change the project's fields?
export function mayCustomise(role: Role, customise: CustomiseRole, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return role !== null && RANK[role] >= RANK[customise];
}
// May this person change a field's definition (name, options, format)? A
// local field: whoever may customise its project. A library field (used in
// several projects; edits show everywhere): its creator and IT only.
export function mayEditDefinition(field: { library: boolean; createdBy: number }, person: { id: number; isAdmin: boolean }, canCustomiseHome: boolean): boolean {
  if (person.isAdmin) return true;
  return field.library ? field.createdBy === person.id : canCustomiseHome;
}

// What the browser gets about a field (lists, board, pane, dialog).
export interface FieldView {
  id: number;
  name: string;
  kind: FieldType;
  options: string[]; // active option names (v1.63 controls)
  description?: string | null;
  library?: boolean;
  notify?: boolean;
  config?: FieldConfig;
  choices?: { id: number; name: string; color: number; archived: boolean }[];
  idPrefix?: string | null;
  showOnCards?: boolean;
  canEdit?: boolean; // may change the definition
}
// A field as the pure rules want it, from what the browser has.
export function viewDef(view: FieldView): FieldDef {
  return { id: view.id, name: view.name, type: view.kind, config: view.config ?? DEFAULT_CONFIG, options: view.choices ?? view.options.map((name, index) => ({ id: -(index + 1), name, color: 0, archived: false })), idPrefix: view.idPrefix ?? null };
}

// ---- values ---------------------------------------------------------------------------
// What the typed columns of task_field_values hold for one value.
export interface StoredValue {
  text: string | null;
  number: number | null;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  optionId: number | null;
  ids: number[] | null;
}
export const EMPTY_STORED: StoredValue = { text: null, number: null, date: null, time: null, optionId: null, ids: null };
export interface FieldDef {
  id: number;
  name: string;
  type: FieldType;
  config: FieldConfig;
  options: { id: number; name: string; color: number; archived: boolean }[];
  idPrefix?: string | null;
}

// Check what someone entered. null / "" / [] clears the value.
// `value` is: TEXT/NUMBER a string (or number); SELECT an option id (or its
// name); MULTI_SELECT option ids; DATE "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM";
// PEOPLE user ids; REFERENCE task ids (checked against what the person sees
// by the service).
// keep (D-393, QA logic #11): MULTI_SELECT options the task already has; an
// archived option may stay chosen but can't be newly added (as for SELECT).
export function checkValue(field: FieldDef, value: unknown, keep: readonly number[] = []): { ok: true; stored: StoredValue | null } | { ok: false; message: string } {
  if (READ_ONLY_TYPES.includes(field.type)) return { ok: false, message: `${field.name} is worked out by the app; it can't be typed.` };
  if (field.type === "TIMER") return { ok: false, message: "Start and stop the timer instead." };
  const empty = value === null || value === undefined || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
  if (empty) return { ok: true, stored: null };
  switch (field.type) {
    case "TEXT": {
      const text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
      return text.length <= TEXT_VALUE_MAX ? { ok: true, stored: { ...EMPTY_STORED, text } } : { ok: false, message: `Use ${TEXT_VALUE_MAX} characters or fewer.` };
    }
    case "NUMBER": {
      // D-234 (Postel): "₹ 1,200", "1 200" and "12.5%" are read as numbers.
      // D-393 (QA logic #7): only symbols ("₹", "%") is not a number (Number("") would be 0).
      const cleaned = typeof value === "number" ? null : String(value).replace(/[,\s₹%]/g, "");
      if (cleaned === "") return { ok: false, message: "Enter a number." };
      const number = typeof value === "number" ? value : Number(cleaned);
      if (!Number.isFinite(number) || Math.abs(number) >= 1e15) return { ok: false, message: "Enter a number." };
      const factor = 10 ** 6;
      return { ok: true, stored: { ...EMPTY_STORED, number: Math.round(number * factor) / factor } };
    }
    case "SELECT": {
      const option = field.options.find((item) => item.id === Number(value) || item.name === value);
      if (!option) return { ok: false, message: "Choose one of the options." };
      if (option.archived) return { ok: false, message: `“${option.name}” is archived; choose another option.` };
      return { ok: true, stored: { ...EMPTY_STORED, optionId: option.id } };
    }
    case "MULTI_SELECT": {
      if (!Array.isArray(value)) return { ok: false, message: "Choose options." };
      const ids = [...new Set(value.map(Number))];
      const options = ids.map((id) => field.options.find((item) => item.id === id));
      if (options.some((item) => !item)) return { ok: false, message: "Choose from the field's options." };
      const archived = options.find((item) => item!.archived && !keep.includes(item!.id));
      if (archived) return { ok: false, message: `“${archived.name}” is archived; choose another option.` };
      return { ok: true, stored: { ...EMPTY_STORED, ids: options.map((item) => item!.id) } };
    }
    case "DATE": {
      const match = /^(\d{4}-\d{2}-\d{2})(?:T(([01]\d|2[0-3]):[0-5]\d))?$/.exec(String(value).trim());
      if (!match || Number.isNaN(new Date(`${match[1]}T00:00:00Z`).getTime()) || new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) return { ok: false, message: "Choose a date." };
      return { ok: true, stored: { ...EMPTY_STORED, date: match[1]!, time: field.config.withTime && match[2] ? match[2] : null } };
    }
    case "PEOPLE":
    case "REFERENCE": {
      if (!Array.isArray(value)) return { ok: false, message: field.type === "PEOPLE" ? "Choose people." : "Choose tasks." };
      const ids = [...new Set(value.map(Number))].filter((id) => Number.isInteger(id) && id > 0);
      const max = field.type === "PEOPLE" ? MAX_PEOPLE : MAX_REFERENCES;
      if (ids.length !== value.length && ids.length === 0) return { ok: false, message: "Choose again." };
      if (ids.length > max) return { ok: false, message: `Choose at most ${max}.` };
      return { ok: true, stored: { ...EMPTY_STORED, ids } };
    }
  }
  return { ok: false, message: "This field can't take a value." };
}

// The plain-text copy written to the old `value` column (v1.63 code reads it).
export function legacyText(field: FieldDef, stored: StoredValue, names: { people?: ReadonlyMap<number, string>; tasks?: ReadonlyMap<number, string> } = {}): string {
  let text = "";
  switch (field.type) {
    case "TEXT":
      text = stored.text ?? "";
      break;
    case "NUMBER":
      text = stored.number === null ? "" : String(stored.number);
      break;
    case "SELECT":
      text = field.options.find((item) => item.id === stored.optionId)?.name ?? "";
      break;
    case "MULTI_SELECT":
      text = (stored.ids ?? []).map((id) => field.options.find((item) => item.id === id)?.name ?? "").filter(Boolean).join(", ");
      break;
    case "DATE":
      text = stored.date ? `${stored.date}${stored.time ? ` ${stored.time}` : ""}` : "";
      break;
    case "PEOPLE":
      text = (stored.ids ?? []).map((id) => names.people?.get(id) ?? `#${id}`).join(", ");
      break;
    case "REFERENCE":
      text = (stored.ids ?? []).map((id) => names.tasks?.get(id) ?? `#${id}`).join(", ");
      break;
    case "ID":
      text = stored.text ?? "";
      break;
    case "TIMER":
      text = timerText(stored.number ?? 0);
      break;
    default:
      text = "";
  }
  return text.slice(0, 500);
}

// ---- cells: what a person sees and what sorts ------------------------------------------
export interface FieldCell {
  text: string; // shown ("" = empty)
  sort: number | string | null;
  edit: string; // a plain control's starting value (text, number, date, option name)
  optionIds?: number[];
  userIds?: number[];
  refs?: { id: number; taskNo: string; title: string }[];
  timer?: { seconds: number; runningSince: string | null; mine: boolean; others: number };
  error?: string;
}
export type CellMap = Record<number, Record<number, FieldCell>>;
export const EMPTY_CELL: FieldCell = { text: "", sort: null, edit: "" };

export interface CellContext {
  people: ReadonlyMap<number, string>;
  tasks: ReadonlyMap<number, { taskNo: string; title: string }>; // tasks the viewer may see
}
// A stored value as a cell (not formula or lookup: see formulaCells).
export function storedCell(field: FieldDef, stored: StoredValue | null, context: CellContext, timer?: FieldCell["timer"]): FieldCell {
  if (field.type === "TIMER") {
    const info = timer ?? { seconds: stored?.number ?? 0, runningSince: null, mine: false, others: 0 };
    return { text: info.seconds || info.runningSince ? timerText(info.seconds) : "", sort: info.seconds || null, edit: "", timer: info };
  }
  if (!stored) return EMPTY_CELL;
  switch (field.type) {
    case "TEXT":
      return { text: stored.text ?? "", sort: stored.text ?? null, edit: stored.text ?? "" };
    case "NUMBER":
      return stored.number === null ? EMPTY_CELL : { text: formatNumber(stored.number, field.config), sort: stored.number, edit: String(stored.number) };
    case "SELECT": {
      const option = field.options.find((item) => item.id === stored.optionId);
      if (!option) return EMPTY_CELL;
      return { text: option.name, sort: field.options.indexOf(option), edit: option.name, optionIds: [option.id] };
    }
    case "MULTI_SELECT": {
      const chosen = field.options.filter((item) => (stored.ids ?? []).includes(item.id));
      if (!chosen.length) return EMPTY_CELL;
      return { text: chosen.map((item) => item.name).join(", "), sort: chosen.map((item) => item.name).join(", "), edit: "", optionIds: chosen.map((item) => item.id) };
    }
    case "DATE":
      return stored.date ? { text: dateText(stored.date, stored.time), sort: `${stored.date}${stored.time ?? ""}`, edit: stored.time ? `${stored.date}T${stored.time}` : stored.date } : EMPTY_CELL;
    case "PEOPLE": {
      const ids = stored.ids ?? [];
      if (!ids.length) return EMPTY_CELL;
      const names = ids.map((id) => context.people.get(id) ?? "Former user");
      return { text: names.join(", "), sort: names.join(", "), edit: "", userIds: ids };
    }
    case "REFERENCE": {
      const refs = (stored.ids ?? []).flatMap((id) => {
        const task = context.tasks.get(id);
        return task ? [{ id, ...task }] : [];
      });
      const hidden = (stored.ids ?? []).length - refs.length;
      const text = [...refs.map((ref) => `${ref.taskNo} ${ref.title}`), ...(hidden ? [`${hidden} task${hidden === 1 ? "" : "s"} you can't see`] : [])].join(", ");
      return text ? { text, sort: text, edit: "", refs } : EMPTY_CELL;
    }
    case "ID":
      return stored.text ? { text: stored.text, sort: stored.number ?? stored.text, edit: stored.text } : EMPTY_CELL;
    default:
      return EMPTY_CELL;
  }
}

// Formula cells for one task: the task's number/date stored values give the
// operands. v1.88.0 (D-418): `task` adds the task's own dates (and Today),
// its first-level subtasks for ROLLUP and the Working calendar for WORKDAYS;
// a formula that gives a date shows as a date (Formatting is for numbers).
export type TaskDates = Partial<Record<Builtin, string | null>>; // YYYY-MM-DD (India days)
export interface FormulaTask {
  dates?: TaskDates;
  subtasks?: readonly { stored: ReadonlyMap<number, StoredValue | null>; dates?: TaskDates }[];
  calendar?: WorkCalendar;
}
// The checks a list needs once, not once per row: kept per field map.
const analysisCache = new WeakMap<ReadonlyMap<number, FieldDef>, Map<number, FormulaAnalysis>>();
export const fxFields = (fields: ReadonlyMap<number, FieldDef> | readonly FieldDef[]): Map<number, FxField> => new Map([...fields.values()].map((field) => [field.id, { id: field.id, name: field.name, kind: field.type, formula: field.config.formula }]));
export function formulaAnalysis(field: FieldDef, fields: ReadonlyMap<number, FieldDef>): FormulaAnalysis {
  let cache = analysisCache.get(fields);
  if (!cache) analysisCache.set(fields, (cache = new Map()));
  const known = cache.get(field.id);
  if (known) return known;
  const map = fxFields(fields);
  if (!map.has(field.id)) map.set(field.id, { id: field.id, name: field.name, kind: field.type, formula: field.config.formula });
  // Saved formulas are worked out without the save-time limits (v1.64 ones had none).
  const result = analyseFormula(field.config.formula, map, null, false);
  cache.set(field.id, result);
  return result;
}
function fieldValueOn(fieldId: number, fields: ReadonlyMap<number, FieldDef>, stored: ReadonlyMap<number, StoredValue | null>, task: FormulaTask, nested: boolean): FormulaResult {
  const memo = new Map<number, FormulaResult>();
  const visiting = new Set<number>();
  const valueOf = (id: number): FormulaResult => {
    const def = fields.get(id);
    if (!def) return { ok: false, error: "MISSING" };
    if (def.type === "NUMBER" || def.type === "TIMER") return { ok: true, value: stored.get(id)?.number ?? null };
    if (def.type === "DATE") {
      const day = stored.get(id)?.date;
      return { ok: true, value: day ? dayNumber(day) : null };
    }
    if (def.type !== "FORMULA") return { ok: false, error: "MISSING" };
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return { ok: false, error: "LOOP" };
    visiting.add(id);
    const analysis = formulaAnalysis(def, fields);
    const result: FormulaResult = analysis.ok
      ? evaluateFormula(analysis.node, {
          field: valueOf,
          builtin: (name) => {
            const day = task.dates?.[name];
            return day ? dayNumber(day) : null;
          },
          rollup: (target) => {
            if (nested) return { ok: false, error: "INVALID" };
            let sum: number | null = null;
            for (const sub of task.subtasks ?? []) {
              const one = fieldValueOn(target, fields, sub.stored, { dates: { ...sub.dates, today: task.dates?.today ?? null }, calendar: task.calendar }, true);
              if (!one.ok) return one;
              if (one.value !== null) sum = (sum ?? 0) + one.value;
            }
            return { ok: true, value: sum };
          },
          calendar: task.calendar,
        })
      : { ok: false, error: analysis.code };
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };
  return valueOf(fieldId);
}
export function formulaCell(field: FieldDef, fields: ReadonlyMap<number, FieldDef>, stored: ReadonlyMap<number, StoredValue | null>, task: FormulaTask = {}): FieldCell {
  const result = fieldValueOn(field.id, fields, stored, task, false);
  if (!result.ok) return { text: FORMULA_ERROR_TEXT[result.error], sort: null, edit: "", error: result.error };
  if (result.value === null) return EMPTY_CELL;
  const analysis = formulaAnalysis(field, fields);
  if (analysis.ok && analysis.type === "date") {
    const day = dayOf(result.value);
    return day ? { text: dateText(day, null), sort: day, edit: "" } : { text: FORMULA_ERROR_TEXT.INVALID, sort: null, edit: "", error: "INVALID" };
  }
  return { text: formatNumber(result.value, field.config), sort: result.value, edit: "" };
}
export function formulaRefs(field: Pick<FieldDef, "config">): number[] {
  const parsed = parseFormula(field.config.formula);
  return parsed.ok ? formulaFields(parsed.node) : [];
}

// ---- filters ---------------------------------------------------------------------------
export const FIELD_FILTER_OPS = ["is", "isNot", "contains", "empty", "notEmpty", "gt", "lt"] as const;
export type FieldFilterOp = (typeof FIELD_FILTER_OPS)[number];
export const FIELD_FILTER_LABEL: Record<FieldFilterOp, string> = { is: "is", isNot: "is not", contains: "contains", empty: "is empty", notEmpty: "is not empty", gt: "is more than", lt: "is less than" };
export const fieldFilterSchema = z.object({ fieldId: z.number().int().positive(), op: z.enum(FIELD_FILTER_OPS), value: z.string().max(100).default("") });
export type FieldFilter = z.infer<typeof fieldFilterSchema>;
export function filterOps(type: FieldType): FieldFilterOp[] {
  switch (type) {
    case "SELECT":
    case "MULTI_SELECT":
    case "PEOPLE":
      return ["is", "isNot", "empty", "notEmpty"];
    case "NUMBER":
    case "FORMULA":
    case "TIMER":
    case "DATE":
      return ["is", "gt", "lt", "empty", "notEmpty"];
    default:
      return ["contains", "is", "empty", "notEmpty"];
  }
}
// Does a cell pass a filter? For selects and people the value is an id
// ("me" = the viewer for people); numbers compare as numbers; dates as days.
export function matchFieldFilter(type: FieldType, cell: FieldCell | undefined, filter: FieldFilter, meId: number): boolean {
  const empty = !cell || cell.text === "";
  if (filter.op === "empty") return empty;
  if (filter.op === "notEmpty") return !empty;
  if (!filter.value) return true;
  if (type === "SELECT" || type === "MULTI_SELECT" || type === "PEOPLE") {
    const ids = (type === "PEOPLE" ? cell?.userIds : cell?.optionIds) ?? [];
    const wanted = filter.value === "me" ? meId : Number(filter.value);
    const has = ids.includes(wanted);
    return filter.op === "isNot" ? !has : has;
  }
  if (type === "NUMBER" || type === "FORMULA" || type === "TIMER" || type === "DATE") {
    if (empty || cell!.sort === null) return false;
    // v1.88.0 (D-418): a formula that gives a date compares as a date.
    const asDate = type === "DATE" || (type === "FORMULA" && typeof cell!.sort === "string");
    const left = asDate ? String(cell!.sort).slice(0, 10) : Number(cell!.sort);
    const right = asDate ? filter.value.slice(0, 10) : Number(type === "TIMER" ? Number(filter.value) * 60 : filter.value.replace(/[,\s₹%]/g, ""));
    if (!asDate && !Number.isFinite(right as number)) return true;
    if (filter.op === "gt") return left > right;
    if (filter.op === "lt") return left < right;
    return left === right;
  }
  const text = (cell?.text ?? "").toLowerCase();
  const wanted = filter.value.toLowerCase();
  if (filter.op === "is") return text === wanted;
  if (filter.op === "isNot") return text !== wanted;
  return text.includes(wanted);
}

// ---- sorting and groups -------------------------------------------------------------------
export function compareCells(a: FieldCell | undefined, b: FieldCell | undefined): number {
  return compareValues(a?.sort ?? null, b?.sort ?? null);
}
// The groups a task falls in when grouped by a field: [name, order] pairs.
// Several for multi-select and people (a task shows under each).
export function fieldGroups(field: FieldDef, cell: FieldCell | undefined, today: string): [string, number][] {
  const none: [string, number] = [`No ${field.name}`, 1e9];
  if (!cell || cell.text === "") return [none];
  switch (field.type) {
    case "SELECT":
    case "MULTI_SELECT":
      return (cell.optionIds ?? []).map((id) => {
        const index = field.options.findIndex((item) => item.id === id);
        return [field.options[index]?.name ?? "Option", index] as [string, number];
      });
    case "PEOPLE":
      return cell.text.split(", ").map((name) => [name, 0] as [string, number]);
    case "DATE": {
      const day = String(cell.sort).slice(0, 10);
      const shift = (n: number) => {
        const date = new Date(`${today}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + n);
        return date.toISOString().slice(0, 10);
      };
      if (day < today) return [["Past", 0]];
      if (day === today) return [["Today", 1]];
      if (day <= shift(7)) return [["Next 7 days", 2]];
      if (day <= shift(30)) return [["Next 30 days", 3]];
      return [["Later", 4]];
    }
    case "NUMBER":
    case "FORMULA":
    case "TIMER":
      return [[cell.text, typeof cell.sort === "number" ? cell.sort : 0]];
    default:
      return [[cell.text, 0]];
  }
}
// Board columns by a field: only a single-select field gives columns a card
// can be moved between (the move sets the option); other types group read-only.
export const boardMovable = (type: FieldType) => type === "SELECT";
