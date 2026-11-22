import { z } from "zod";
import { checkFormDefinition, displayValue, formSchema, isIsoDate, OPTION_TYPES, type FormField } from "@/server/forms/fields";
import { isConditionGroup, ruleComparisons, upgradeRule, type RuleCondition } from "@/server/conditions/rule";
import { addWorkDays, type WorkCalendar } from "@/server/work/schedule";
import { PRIORITY_LABEL, TASK_PRIORITIES, type TaskPriority } from "@/server/modules/settings";

// v1.66.0 (D-374, PM phase C, spec FORMS_MODULE): project intake forms. A
// "Project intake form" is a kind of the shared Form Builder: its questions
// are the builder's FormField list (server/forms/fields.ts), checked by the
// same checkFormDefinition and parsed by the same parseFormSubmission, with
// branching on the same show-if rules (server/conditions/rule.ts). This file
// adds only what intake forms need on top: the allowed question types, the
// mapping of questions to task fields and project custom fields, the
// settings, the branch helpers, the task title, description and due date.
// Pure: used by the builder, the fill view and the server (which decides).

// ---- question types ---------------------------------------------------------------------
export const INTAKE_TYPES = ["TEXT", "LONG_TEXT", "CHOICE", "MULTI_CHOICE", "DATE", "NUMBER", "ATTACHMENT", "SECTION"] as const;
export type IntakeType = (typeof INTAKE_TYPES)[number];
export const isIntakeType = (value: unknown): value is IntakeType => typeof value === "string" && (INTAKE_TYPES as readonly string[]).includes(value);
export const INTAKE_TYPE_LABEL: Record<IntakeType, string> = {
  TEXT: "Text",
  LONG_TEXT: "Long text",
  CHOICE: "Single-select",
  MULTI_CHOICE: "Multi-select",
  DATE: "Date",
  NUMBER: "Number",
  ATTACHMENT: "Attachment",
  SECTION: "Heading",
};
export const BRANCH_TYPES: readonly string[] = ["CHOICE", "MULTI_CHOICE"];
export const MAX_BRANCH_DEPTH = 5; // BR-FORM-002
export const MAX_FORMS_PER_PROJECT = 20; // BR-FORM-018
export const SUBMISSIONS_PER_HOUR = 20; // per person per form
export const FORM_NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const CONFIRMATION_MAX = 500;
export const TASK_DESCRIPTION_MAX = 4000;
export const DEFAULT_DUE_OFFSET = 3; // working days (C-3)
export const COVER_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

// ---- mapping ("Connect to field") --------------------------------------------------------
export const TASK_TARGETS = ["title", "description", "due", "priority"] as const;
export type TaskTarget = (typeof TASK_TARGETS)[number];
export const TASK_TARGET_LABEL: Record<TaskTarget, string> = { title: "Task name", description: "Task description", due: "Due date", priority: "Priority" };
const targetSchema = z.union([z.object({ kind: z.literal("TASK"), field: z.enum(TASK_TARGETS) }).strict(), z.object({ kind: z.literal("FIELD"), fieldId: z.number().int().positive() }).strict()]);
export type MappingTarget = z.infer<typeof targetSchema>;
export const sameTarget = (a: MappingTarget, b: MappingTarget) => (a.kind === "TASK" && b.kind === "TASK" ? a.field === b.field : a.kind === "FIELD" && b.kind === "FIELD" ? a.fieldId === b.fieldId : false);

// A project custom field as the mapping sees it (server/work/custom-fields.ts types).
export interface ProjectFieldInfo {
  id: number;
  name: string;
  type: string;
  options: { name: string; archived?: boolean }[];
}

// The priority option names (as people see them) for a mapped Single-select.
export const PRIORITY_OPTION_NAMES: string[] = TASK_PRIORITIES.map((code) => PRIORITY_LABEL[code]);
export function priorityFromLabel(label: string): TaskPriority | null {
  const code = TASK_PRIORITIES.find((item) => PRIORITY_LABEL[item].toLowerCase() === label.trim().toLowerCase());
  return code ?? null;
}

// Which question types each custom field type takes. Assignee is never mappable
// (C-2: the form's default assignee); read-only, people, timer, reference
// fields never are (BR-CF-005).
const FIELD_TYPE_FOR: Record<string, readonly string[]> = { TEXT: ["TEXT", "LONG_TEXT"], NUMBER: ["NUMBER"], DATE: ["DATE"], SELECT: ["CHOICE"], MULTI_SELECT: ["MULTI_CHOICE"] };

// Why this question can't be connected to that target (null: it can).
export function mappingProblem(question: Pick<FormField, "type" | "options" | "label">, target: MappingTarget, projectFields: readonly ProjectFieldInfo[]): string | null {
  if (question.type === "SECTION" || question.type === "ATTACHMENT") return "Headings and attachments can't be connected to a field.";
  if (target.kind === "TASK") {
    switch (target.field) {
      case "title":
        return question.type === "TEXT" ? null : "Only a Text question can give the task name.";
      case "description":
        return question.type === "TEXT" || question.type === "LONG_TEXT" ? null : "Only a Text or Long text question can go into the description.";
      case "due":
        return question.type === "DATE" ? null : "Only a Date question can set the due date.";
      case "priority": {
        if (question.type !== "CHOICE") return "Only a Single-select question can set the priority.";
        const unknown = (question.options ?? []).filter((option) => !priorityFromLabel(option));
        return unknown.length ? `Priority options must be ${PRIORITY_OPTION_NAMES.join(", ")} (not ${unknown.join(", ")}).` : null;
      }
    }
  }
  const field = projectFields.find((item) => item.id === target.fieldId);
  if (!field) return "That field isn't in this project any more.";
  const allowed = FIELD_TYPE_FOR[field.type];
  if (!allowed) return `${field.name} can't be filled in from a form.`;
  if (!allowed.includes(question.type)) return `${field.name} doesn't take this type of answer.`;
  if (OPTION_TYPES.includes(question.type)) {
    const names = new Set(field.options.filter((option) => !option.archived).map((option) => option.name.toLowerCase()));
    const missing = (question.options ?? []).filter((option) => !names.has(option.toLowerCase()));
    if (missing.length) return `${field.name} has no option ${missing.map((item) => `“${item}”`).join(", ")}.`;
  }
  return null;
}

// Everything a question could be connected to, with whether it fits.
export function connectChoices(question: FormField, projectFields: readonly ProjectFieldInfo[]): { value: string; label: string; target: MappingTarget; problem: string | null }[] {
  const out: { value: string; label: string; target: MappingTarget; problem: string | null }[] = [];
  for (const field of TASK_TARGETS) {
    const target: MappingTarget = { kind: "TASK", field };
    out.push({ value: `task:${field}`, label: TASK_TARGET_LABEL[field], target, problem: mappingProblem(question, target, projectFields) });
  }
  for (const field of projectFields) {
    const target: MappingTarget = { kind: "FIELD", fieldId: field.id };
    out.push({ value: `field:${field.id}`, label: field.name, target, problem: mappingProblem(question, target, projectFields) });
  }
  return out;
}
export const targetValue = (target: MappingTarget) => (target.kind === "TASK" ? `task:${target.field}` : `field:${target.fieldId}`);
export function targetFromValue(value: string): MappingTarget | null {
  const task = /^task:(title|description|due|priority)$/.exec(value);
  if (task) return { kind: "TASK", field: task[1] as TaskTarget };
  const field = /^field:(\d{1,10})$/.exec(value);
  return field ? { kind: "FIELD", fieldId: Number(field[1]) } : null;
}

// ---- the draft and the settings ------------------------------------------------------------
export const draftSchema = z.object({ fields: formSchema, mappings: z.record(z.string().max(50), targetSchema).default({}) });
export interface IntakeDraft {
  fields: FormField[];
  mappings: Record<string, MappingTarget>;
}
export const EMPTY_DRAFT: IntakeDraft = { fields: [], mappings: {} };
export function parseDraft(raw: unknown): IntakeDraft {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  const parsed = draftSchema.safeParse(value);
  return parsed.success ? { fields: parsed.data.fields as FormField[], mappings: parsed.data.mappings } : EMPTY_DRAFT;
}

export const AUDIENCES = ["EVERYONE", "DEPARTMENTS", "MEMBERS"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = { EVERYONE: "Everyone signed in", DEPARTMENTS: "People in chosen departments", MEMBERS: "Members of this project" };
export const settingsSchema = z.object({
  sectionId: z.number().int().positive().nullable().default(null),
  assigneeId: z.number().int().positive().nullable().default(null),
  dueOffsetDays: z.number().int().min(0).max(365).nullable().default(DEFAULT_DUE_OFFSET),
  copyToDescription: z.boolean().default(true),
  confirmation: z.string().max(CONFIRMATION_MAX).default(""),
  submitAnother: z.boolean().default(false),
  addFollowers: z.boolean().default(true),
  audience: z.enum(AUDIENCES).default("EVERYONE"),
  departmentIds: z.array(z.number().int().positive()).max(50).default([]),
  notifyOwner: z.boolean().default(true),
  notifyAssignee: z.boolean().default(true),
});
export type IntakeSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: IntakeSettings = settingsSchema.parse({});
export function parseSettings(raw: unknown): IntakeSettings {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  const parsed = settingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- branching ("Add branch": per option of a select question) ----------------------------
// A follow-up question's showIf is "<source> is any of <options>" (operator IN),
// the existing show-if rule, so the shared evaluator shows and clears it.
export function branchOf(field: Pick<FormField, "showIf">): { source: string; options: string[] } | null {
  if (!field.showIf) return null;
  const rule = upgradeRule(field.showIf) as RuleCondition;
  const comparisons = ruleComparisons(rule);
  if (isConditionGroup(rule) && rule.match !== "ANY") return null;
  const source = comparisons[0]?.field;
  if (!source || comparisons.some((item) => item.field !== source || (item.operator !== "IN" && item.operator !== "EQ"))) return null;
  const options = comparisons.flatMap((item) => (Array.isArray(item.value) ? item.value.map(String) : item.value === undefined ? [] : [String(item.value)]));
  return { source, options: [...new Set(options)] };
}

// The questions shown when `option` of `source` is chosen.
export const branchTargets = (fields: readonly FormField[], source: string, option: string): string[] =>
  fields.filter((field) => {
    const branch = branchOf(field);
    return branch?.source === source && branch.options.includes(option);
  }).map((field) => field.key);

// Turn "show <target> when <source> is <option>" on or off. A question follows
// one source; picking another source replaces its rule.
export function setBranch(fields: readonly FormField[], source: string, option: string, target: string, on: boolean): FormField[] {
  return fields.map((field) => {
    if (field.key !== target) return field;
    const branch = branchOf(field);
    const options = branch?.source === source ? branch.options : [];
    const next = on ? [...new Set([...options, option])] : options.filter((item) => item !== option);
    const { showIf: _old, ...rest } = field;
    void _old;
    return next.length ? { ...rest, showIf: { field: source, operator: "IN" as const, value: next } } : rest;
  });
}

// How deep a question sits in branches (0 = always shown).
export function branchDepth(fields: readonly FormField[], key: string): number {
  let depth = 0;
  let current = fields.find((field) => field.key === key);
  const seen = new Set<string>();
  while (current) {
    const branch = branchOf(current);
    if (!branch || seen.has(current.key)) break;
    seen.add(current.key);
    depth += 1;
    current = fields.find((field) => field.key === branch.source);
  }
  return depth;
}

// Questions that may follow an option of `source`: later ones, not headings,
// not itself, and not deeper than the limit.
export function branchCandidates(fields: readonly FormField[], source: string): FormField[] {
  const at = fields.findIndex((field) => field.key === source);
  if (at < 0) return [];
  const depth = branchDepth(fields, source);
  if (depth + 1 > MAX_BRANCH_DEPTH) return [];
  return fields.slice(at + 1).filter((field) => field.type !== "SECTION");
}

// ---- the whole form check (publish) --------------------------------------------------------
export interface FormProblem {
  key?: string; // the question, when the problem is on one
  message: string;
}
export interface CheckContext {
  sectionIds: readonly number[];
  projectFields: readonly ProjectFieldInfo[];
  assigneeActive: boolean; // the default assignee is an active person
}
export function checkIntakeForm(form: { name: string; draft: IntakeDraft; settings: IntakeSettings }, context: CheckContext): FormProblem[] {
  const problems: FormProblem[] = [];
  const { fields, mappings } = form.draft;
  if (!form.name.trim()) problems.push({ message: "Give the form a title." });
  if (form.name.length > FORM_NAME_MAX) problems.push({ message: `Use ${FORM_NAME_MAX} characters or fewer for the title.` });
  if (!fields.some((field) => field.type !== "SECTION")) problems.push({ message: "Add at least one question." });
  for (const field of fields) {
    if (!isIntakeType(field.type)) problems.push({ key: field.key, message: `“${field.label || field.key}”: this question type can't be used on a project form.` });
    if (BRANCH_TYPES.includes(field.type) && !(field.options ?? []).some((option) => option.trim())) problems.push({ key: field.key, message: `“${field.label || "New question"}”: question values must be specified.` });
  }
  // The shared builder's own checks (labels, keys, options, rules, cycles).
  for (const message of checkFormDefinition(fields)) problems.push({ message });
  // Branches: a select question earlier in the form, its own options, at most 5 levels.
  for (const [index, field] of fields.entries()) {
    if (!field.showIf) continue;
    const branch = branchOf(field);
    const name = field.label || "A question";
    if (!branch) {
      problems.push({ key: field.key, message: `“${name}”: on a project form a question can only follow an option of a select question.` });
      continue;
    }
    const sourceIndex = fields.findIndex((other) => other.key === branch.source);
    const source = fields[sourceIndex];
    if (!source || !BRANCH_TYPES.includes(source.type)) problems.push({ key: field.key, message: `“${name}” follows a question that isn't a select question.` });
    else if (sourceIndex > index) problems.push({ key: field.key, message: `“${name}” must come after “${source.label}”, the question it follows.` });
    else if (branch.options.some((option) => !(source.options ?? []).includes(option))) problems.push({ key: field.key, message: `“${name}” follows an option “${source.label}” no longer has.` });
    if (branchDepth(fields, field.key) > MAX_BRANCH_DEPTH) problems.push({ key: field.key, message: `“${name}”: branches go at most ${MAX_BRANCH_DEPTH} levels deep.` });
  }
  // Mappings: each question once, each target once, compatible types.
  const used: MappingTarget[] = [];
  for (const [key, target] of Object.entries(mappings)) {
    const field = fields.find((item) => item.key === key);
    if (!field) continue; // a removed question's mapping is dropped when saved
    const problem = mappingProblem(field, target, context.projectFields);
    if (problem) problems.push({ key, message: `“${field.label}”: ${problem}` });
    if (used.some((other) => sameTarget(other, target))) problems.push({ key, message: `“${field.label}”: another question is already connected to that field.` });
    used.push(target);
  }
  // Settings (C-2, C-3).
  const { settings } = form;
  if (context.sectionIds.length === 0) problems.push({ message: "Add a section to the project first: submissions go into a section." });
  if (settings.assigneeId === null) problems.push({ message: "Choose a default assignee (Settings)." });
  else if (!context.assigneeActive) problems.push({ message: "The default assignee isn't an active person any more; choose another (Settings)." });
  if (settings.dueOffsetDays === null) problems.push({ message: "Set the due date: how many working days after the submission (Settings)." });
  if (settings.audience === "DEPARTMENTS" && settings.departmentIds.length === 0) problems.push({ message: "Choose at least one department that may submit (Settings)." });
  return problems;
}

// Mappings of questions that still exist (the builder keeps them in step).
export function cleanMappings(fields: readonly FormField[], mappings: Record<string, MappingTarget>): Record<string, MappingTarget> {
  const keys = new Set(fields.filter((field) => field.type !== "SECTION" && field.type !== "ATTACHMENT").map((field) => field.key));
  return Object.fromEntries(Object.entries(mappings).filter(([key]) => keys.has(key)));
}

// ---- who may submit ------------------------------------------------------------------------
export function mayFill(settings: Pick<IntakeSettings, "audience" | "departmentIds">, person: { departmentId: number | null; isMember: boolean; canBuild: boolean }): boolean {
  if (person.canBuild) return true; // the form's own builders may always try it
  if (settings.audience === "EVERYONE") return true;
  if (settings.audience === "MEMBERS") return person.isMember;
  return person.departmentId !== null && settings.departmentIds.includes(person.departmentId);
}

// ---- the task ------------------------------------------------------------------------------
const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// BR-FORM-006: the mapped answer, or "<Form name> submission" when there is none.
export function submissionTitle(formName: string, answer: unknown): string {
  const text = typeof answer === "string" ? clean(answer, 200) : "";
  return text || clean(`${formName} submission`, 200);
}

// C-3: due `offset` working days after today (India), skipping weekly offs and holidays.
export function dueDayFor(today: string, offset: number, calendar: WorkCalendar): string {
  return addWorkDays(today, Math.max(0, offset), calendar, true);
}

// A mapped date answer must not be in the past.
export function dueAnswerProblem(answer: unknown, today: string): string | null {
  if (answer === undefined || answer === null || answer === "") return null;
  if (!isIsoDate(answer)) return "Choose a valid date.";
  return answer < today ? "Choose today or a later date." : null;
}

export interface DescribeInput {
  formName: string;
  link: string;
  submitter: { name: string; email: string };
  fields: readonly FormField[];
  data: Record<string, unknown>;
  shown: ReadonlySet<string>;
  copyAll: boolean;
  descriptionKey: string | null; // the question mapped to the task description
  fileNames: Readonly<Record<string, string[]>>;
}
// BR-FORM spec §3.11, our wording: the mapped description first, then
// "Label: value" for every answered question in form order (unanswered and
// hidden ones left out; dates and files included, the spec's observed gap),
// then a divider and the footer with the form link. Plain text, never HTML.
export function describeSubmission(input: DescribeInput): string {
  const parts: string[] = [];
  const lead = input.descriptionKey ? input.data[input.descriptionKey] : undefined;
  if (typeof lead === "string" && lead.trim()) parts.push(lead.trim());
  if (input.copyAll) {
    const lines = [`Name: ${input.submitter.name}`, `Email: ${input.submitter.email}`];
    for (const field of input.fields) {
      if (field.type === "SECTION" || !input.shown.has(field.key)) continue;
      const value = input.data[field.key];
      if (value === undefined || value === null || value === "") continue;
      if (field.type === "ATTACHMENT") {
        const names = input.fileNames[field.key] ?? [];
        lines.push(`${field.label}: ${names.length ? names.join(", ") : displayValue(field, value, new Map())}`);
        continue;
      }
      const text = displayValue(field, value, new Map());
      lines.push(field.type === "LONG_TEXT" && text.includes("\n") ? `${field.label}:\n${text}` : `${field.label}: ${text}`);
    }
    parts.push(lines.join("\n"));
  }
  const footer = `———\nSubmitted through the form ${input.formName} by ${input.submitter.name}.\n${input.link}`;
  const room = TASK_DESCRIPTION_MAX - footer.length - 2;
  let body = parts.join("\n\n");
  if (body.length > room) body = `${body.slice(0, Math.max(0, room - 2))}…`;
  return body ? `${body}\n\n${footer}` : footer;
}
