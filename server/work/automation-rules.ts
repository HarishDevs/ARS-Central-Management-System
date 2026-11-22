import { z } from "zod";
import { PRIORITY_LABEL, TASK_PRIORITIES, type TaskPriority } from "@/server/modules/settings";
import { addDays } from "@/server/work/schedule";

// v1.68.0 (D-380, PM phase D part 2, spec PROJECTS_CUSTOMIZATION §2,
// AUTOMATION_WORKFLOWS): project automations ("rules"). A rule is one
// trigger, a list of steps and optional Paths: if/else branches (the first
// path whose conditions match runs its steps; else "Otherwise"). Rules are
// stored as JSON (one draft the builder edits, one published copy that runs).
// Pure: used by the builder (inline problems), the server (which decides
// and checks everything again) and the engine (matching and conditions).

// ---- vocabulary --------------------------------------------------------------------------------
export const TRIGGER_TYPES = [
  "TASK_ADDED",
  "MOVED_TO_SECTION",
  "FIELD_CHANGED",
  "STATUS_CHANGED",
  "ASSIGNEE_CHANGED",
  "DUE_APPROACHING",
  "OVERDUE",
  "ATTACHMENT_ADDED",
  "COMMENT_ADDED",
  "COLLABORATOR_ADDED",
  "FORM_SUBMITTED",
  "MANUAL",
  "SCHEDULED",
  "WEBHOOK",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export const TRIGGER_LABEL: Record<TriggerType, string> = {
  TASK_ADDED: "Task is added to this project",
  MOVED_TO_SECTION: "Task is moved to a section",
  FIELD_CHANGED: "A field is changed",
  STATUS_CHANGED: "Completion status is changed",
  ASSIGNEE_CHANGED: "Task is assigned",
  DUE_APPROACHING: "Due date is approaching",
  OVERDUE: "Task is overdue",
  ATTACHMENT_ADDED: "Attachment is added",
  COMMENT_ADDED: "Comment is added",
  COLLABORATOR_ADDED: "Collaborator is added",
  FORM_SUBMITTED: "Form is submitted",
  MANUAL: "Run by hand (from a task's menu)",
  SCHEDULED: "On a schedule",
  WEBHOOK: "Web request received (webhook)",
};
// Groups for the trigger picker (the spec's catalogue, our words).
export const TRIGGER_GROUPS: { label: string; types: TriggerType[] }[] = [
  { label: "Task moved", types: ["TASK_ADDED", "MOVED_TO_SECTION"] },
  { label: "Task field is changed", types: ["FIELD_CHANGED", "ASSIGNEE_CHANGED", "STATUS_CHANGED"] },
  { label: "Due date is…", types: ["DUE_APPROACHING", "OVERDUE"] },
  { label: "Added to task", types: ["ATTACHMENT_ADDED", "COMMENT_ADDED", "COLLABORATOR_ADDED"] },
  { label: "Other starts", types: ["FORM_SUBMITTED", "MANUAL", "SCHEDULED", "WEBHOOK"] },
];

export const STEP_TYPES = [
  "MOVE_TO_SECTION",
  "ADD_TO_PROJECT",
  "SET_STATUS",
  "SET_ASSIGNEE",
  "SET_DUE",
  "SET_PRIORITY",
  "SET_FIELD",
  "CREATE_TASK",
  "CREATE_SUBTASKS",
  "ADD_COMMENT",
  "ADD_COLLABORATORS",
  "NOTIFY",
] as const;
export type StepType = (typeof STEP_TYPES)[number];
export const STEP_LABEL: Record<StepType, string> = {
  MOVE_TO_SECTION: "Move to a section",
  ADD_TO_PROJECT: "Add to another project",
  SET_STATUS: "Change completion status",
  SET_ASSIGNEE: "Change assignee",
  SET_DUE: "Change due date",
  SET_PRIORITY: "Change priority",
  SET_FIELD: "Change a custom field",
  CREATE_TASK: "Create a task",
  CREATE_SUBTASKS: "Create subtasks",
  ADD_COMMENT: "Add a comment",
  ADD_COLLABORATORS: "Add collaborators",
  NOTIFY: "Notify people",
};
export const STEP_GROUPS: { label: string; types: StepType[] }[] = [
  { label: "Move task", types: ["MOVE_TO_SECTION", "ADD_TO_PROJECT"] },
  { label: "Change status", types: ["SET_STATUS"] },
  { label: "Change task field", types: ["SET_ASSIGNEE", "SET_DUE", "SET_PRIORITY", "SET_FIELD"] },
  { label: "Create new", types: ["CREATE_TASK", "CREATE_SUBTASKS"] },
  { label: "Add to task", types: ["ADD_COMMENT", "ADD_COLLABORATORS", "NOTIFY"] },
];

export const BUILT_IN_FIELDS = ["name", "due", "start", "priority"] as const;
export type BuiltInField = (typeof BUILT_IN_FIELDS)[number];
export const BUILT_IN_FIELD_LABEL: Record<BuiltInField, string> = { name: "Task name", due: "Due date", start: "Start date", priority: "Priority" };
export const STATUS_TRIGGER = ["ANY", "COMPLETED", "INCOMPLETE", "BLOCKED"] as const;
export const STATUS_TRIGGER_LABEL: Record<(typeof STATUS_TRIGGER)[number], string> = { ANY: "Any change", COMPLETED: "Marked complete", INCOMPLETE: "Marked incomplete (reopened)", BLOCKED: "Marked blocked" };
export const SUBJECTS = ["SECTION", "ASSIGNEE", "PRIORITY", "DUE_STATUS", "COMPLETION", "NAME", "FIELD"] as const;
export type Subject = (typeof SUBJECTS)[number];
export const SUBJECT_LABEL: Record<Subject, string> = { SECTION: "Section", ASSIGNEE: "Assignee", PRIORITY: "Priority", DUE_STATUS: "Due date status", COMPLETION: "Completion status", NAME: "Task name", FIELD: "Custom field" };
export const OPS = ["IS", "IS_NOT", "IS_SET", "IS_NOT_SET", "CONTAINS", "GT", "LT"] as const;
export type Op = (typeof OPS)[number];
export const OP_LABEL: Record<Op, string> = { IS: "is", IS_NOT: "is not", IS_SET: "is set", IS_NOT_SET: "is not set", CONTAINS: "contains", GT: "is more than / after", LT: "is less than / before" };
export const DUE_STATUSES = ["OVERDUE", "TODAY", "SOON", "LATER", "NONE", "DONE"] as const;
export type DueStatus = (typeof DUE_STATUSES)[number];
export const DUE_STATUS_LABEL: Record<DueStatus, string> = { OVERDUE: "Overdue", TODAY: "Due today", SOON: "Due in the next 7 days", LATER: "Due later", NONE: "No due date", DONE: "Done" };
export const COMPLETION_VALUES = ["COMPLETE", "INCOMPLETE", "BLOCKED"] as const;
export const COMPLETION_LABEL: Record<(typeof COMPLETION_VALUES)[number], string> = { COMPLETE: "Complete", INCOMPLETE: "Incomplete", BLOCKED: "Blocked" };
export const NOTIFY_TARGETS = ["ASSIGNEE", "COLLABORATORS", "PROJECT_OWNERS"] as const;
export const NOTIFY_TARGET_LABEL: Record<(typeof NOTIFY_TARGETS)[number], string> = { ASSIGNEE: "The assignee", COLLABORATORS: "The task's collaborators", PROJECT_OWNERS: "The project's owners" };

// ---- limits -------------------------------------------------------------------------------------
// C-8 / BR-AUTO-001: Admin → Task settings (defaults 50 rules a project, 20 steps a rule).
export const AUTOMATION_LIMITS_KEY = "tasks.automation_limits";
export const automationLimitsSchema = z.object({
  perProject: z.number().int().min(1).max(200).default(50),
  stepsPerRule: z.number().int().min(1).max(50).default(20),
});
export type AutomationLimits = z.infer<typeof automationLimitsSchema>;
export const DEFAULT_AUTOMATION_LIMITS: AutomationLimits = automationLimitsSchema.parse({});
export function parseAutomationLimits(raw: string | null | undefined): AutomationLimits {
  try {
    const parsed = automationLimitsSchema.safeParse(raw ? JSON.parse(raw) : {});
    return parsed.success ? parsed.data : DEFAULT_AUTOMATION_LIMITS;
  } catch {
    return DEFAULT_AUTOMATION_LIMITS;
  }
}
export const RULE_NAME_MAX = 120;
export const MAX_PATHS = 5;
export const MAX_CONDITIONS = 10;
export const MAX_SUBTASKS = 20;
export const MAX_PEOPLE_PER_STEP = 20;
export const TEXT_MAX = 2000;
export const MAX_CHAIN_DEPTH = 3; // at most 3 rules in a chain (task brief; spec BR-AUTO-004 says 5)
export const RUNS_PER_HOUR = 500; // per rule
export const GLOBAL_RUNS_PER_HOUR = 5000; // all rules together
export const RUN_LOG_KEEP = 200;
export const SCHEDULED_TASK_CAP = 200; // tasks a scheduled or time trigger handles per rule per run
export const WEBHOOK_PER_MINUTE = 60;
export const WEBHOOK_BODY_MAX = 16_000;
export const WEBHOOK_KEEP_DAYS = 30;

// ---- the definition -----------------------------------------------------------------------------
const id = z.number().int().positive().max(9_999_999_999);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const conditionSchema = z.object({
  subject: z.enum(SUBJECTS),
  fieldId: id.nullable().optional(),
  op: z.enum(OPS),
  value: z.union([z.string().max(500), z.number(), z.null()]).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const triggerSchema = z.object({
  type: z.enum(TRIGGER_TYPES),
  sectionId: id.nullable().optional(), // TASK_ADDED, MOVED_TO_SECTION (null = any); WEBHOOK create: where
  field: z.string().max(24).nullable().optional(), // FIELD_CHANGED: name | due | start | priority | f<id>
  value: z.union([z.string().max(500), z.number(), z.null()]).optional(), // FIELD_CHANGED: a specific value
  status: z.enum(STATUS_TRIGGER).optional(),
  userId: id.nullable().optional(), // ASSIGNEE_CHANGED: to this person (null = anyone)
  days: z.number().int().min(0).max(60).optional(), // DUE_APPROACHING
  formId: id.nullable().optional(), // FORM_SUBMITTED (null = any form of the project)
  frequency: z.enum(["DAILY", "WEEKLY"]).optional(), // SCHEDULED
  weekday: z.number().int().min(0).max(6).optional(), // 0 = Sunday
  time: time.optional(),
  filter: z.array(conditionSchema).max(MAX_CONDITIONS).optional(), // SCHEDULED: which tasks
  webhookMode: z.enum(["CREATE", "UPDATE"]).optional(),
  assigneeId: id.nullable().optional(), // WEBHOOK create: who gets the task (null = the rule's owner)
});
export type Trigger = z.infer<typeof triggerSchema>;

export const stepSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
  type: z.enum(STEP_TYPES),
  sectionId: id.nullable().optional(),
  projectId: id.nullable().optional(),
  status: z.enum(["COMPLETE", "REOPEN"]).optional(),
  userId: id.nullable().optional(), // SET_ASSIGNEE; CREATE_*: null = the task's assignee
  userIds: z.array(id).max(MAX_PEOPLE_PER_STEP).optional(),
  targets: z.array(z.enum(NOTIFY_TARGETS)).max(3).optional(),
  days: z.number().int().min(0).max(365).optional(),
  workingDays: z.boolean().optional(),
  priority: z.string().max(20).optional(),
  fieldId: id.nullable().optional(),
  value: z.union([z.string().max(500), z.number(), z.array(z.number()), z.null()]).optional(),
  title: z.string().max(200).optional(),
  titles: z.array(z.string().max(200)).max(MAX_SUBTASKS).optional(),
  text: z.string().max(TEXT_MAX).optional(),
});
export type Step = z.infer<typeof stepSchema>;

export const pathSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
  name: z.string().max(60),
  match: z.enum(["ALL", "ANY"]),
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS),
  steps: z.array(stepSchema).max(50),
});
export type Path = z.infer<typeof pathSchema>;

export const definitionSchema = z.object({
  trigger: triggerSchema.nullable(),
  steps: z.array(stepSchema).max(50),
  paths: z.array(pathSchema).max(MAX_PATHS),
  otherwise: z.array(stepSchema).max(50),
});
export type RuleDefinition = z.infer<typeof definitionSchema>;
export const EMPTY_DEFINITION: RuleDefinition = { trigger: null, steps: [], paths: [], otherwise: [] };

export function parseDefinition(raw: unknown): RuleDefinition {
  const parsed = definitionSchema.safeParse(typeof raw === "string" ? safeJson(raw) : raw);
  return parsed.success ? parsed.data : EMPTY_DEFINITION;
}
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
export const allSteps = (def: RuleDefinition): Step[] => [...def.steps, ...def.paths.flatMap((path) => path.steps), ...def.otherwise];
export const fieldKey = (fieldId: number) => `f${fieldId}`;
export const fieldIdOf = (key: string | null | undefined): number | null => (key && /^f\d{1,10}$/.test(key) ? Number(key.slice(1)) : null);

// ---- checking (inline problems in the builder; Publish needs none) ---------------------------------
export interface FieldInfo {
  id: number;
  name: string;
  type: string; // custom field type (TEXT, NUMBER, SELECT, MULTI_SELECT, DATE, PEOPLE, …)
  options: { id: number; name: string; archived: boolean }[];
}
export interface CheckContext {
  sectionIds: readonly number[];
  fields: readonly FieldInfo[];
  formIds: readonly number[];
  activePeople: ReadonlySet<number>;
  // ADD_TO_PROJECT targets the owner may edit, with their sections.
  targetProjects: ReadonlyMap<number, readonly number[]>;
  maxSteps: number;
}
export interface RuleProblem {
  where: string; // "name" | "trigger" | "step:<key>" | "path:<key>" | "rule"
  message: string;
}
const WRITABLE_FIELD_TYPES = ["TEXT", "NUMBER", "SELECT", "MULTI_SELECT", "DATE", "PEOPLE"];
const CONDITION_FIELD_TYPES = ["TEXT", "NUMBER", "SELECT", "MULTI_SELECT", "DATE", "PEOPLE", "FORMULA", "ID", "TIMER"];
export const writableField = (field: Pick<FieldInfo, "type">) => WRITABLE_FIELD_TYPES.includes(field.type);
export const conditionField = (field: Pick<FieldInfo, "type">) => CONDITION_FIELD_TYPES.includes(field.type);

// Which operators make sense for a subject (and field type).
export function opsFor(subject: Subject, fieldType?: string): Op[] {
  switch (subject) {
    case "SECTION":
    case "ASSIGNEE":
    case "PRIORITY":
    case "DUE_STATUS":
    case "COMPLETION":
      return ["IS", "IS_NOT"];
    case "NAME":
      return ["IS", "CONTAINS"];
    case "FIELD":
      switch (fieldType) {
        case "SELECT":
          return ["IS", "IS_NOT", "IS_SET", "IS_NOT_SET"];
        case "MULTI_SELECT":
        case "PEOPLE":
          return ["CONTAINS", "IS_SET", "IS_NOT_SET"];
        case "NUMBER":
        case "FORMULA":
        case "TIMER":
        case "DATE":
          return ["IS", "GT", "LT", "IS_SET", "IS_NOT_SET"];
        case "TEXT":
        case "ID":
          return ["IS", "CONTAINS", "IS_SET", "IS_NOT_SET"];
        default:
          return ["IS_SET", "IS_NOT_SET"];
      }
  }
}
export const opNeedsValue = (op: Op) => op !== "IS_SET" && op !== "IS_NOT_SET";

function checkCondition(condition: Condition, ctx: CheckContext): string | null {
  const field = condition.subject === "FIELD" ? ctx.fields.find((item) => item.id === condition.fieldId) : undefined;
  if (condition.subject === "FIELD" && (!field || !conditionField(field))) return "Choose a field of this project.";
  if (!opsFor(condition.subject, field?.type).includes(condition.op)) return "Choose how to compare.";
  if (!opNeedsValue(condition.op)) return null;
  const value = condition.value;
  if (value === null || value === undefined || value === "") return "Choose a value.";
  switch (condition.subject) {
    case "SECTION":
      return ctx.sectionIds.includes(Number(value)) ? null : "Choose a section of this project.";
    case "ASSIGNEE":
      return ctx.activePeople.has(Number(value)) ? null : "Choose an active person.";
    case "PRIORITY":
      return (TASK_PRIORITIES as readonly string[]).includes(String(value)) ? null : "Choose a priority.";
    case "DUE_STATUS":
      return (DUE_STATUSES as readonly string[]).includes(String(value)) ? null : "Choose a due date status.";
    case "COMPLETION":
      return (COMPLETION_VALUES as readonly string[]).includes(String(value)) ? null : "Choose a status.";
    case "FIELD":
      if (field!.type === "SELECT" || field!.type === "MULTI_SELECT") return field!.options.some((option) => option.id === Number(value)) ? null : "Choose one of the field's options.";
      if (field!.type === "PEOPLE") return ctx.activePeople.has(Number(value)) ? null : "Choose an active person.";
      if (field!.type === "DATE") return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? null : "Choose a date.";
      if (["NUMBER", "FORMULA", "TIMER"].includes(field!.type)) return Number.isFinite(Number(value)) ? null : "Enter a number.";
      return null;
    default:
      return null;
  }
}

function checkTrigger(trigger: Trigger | null, ctx: CheckContext): string | null {
  if (!trigger) return "Choose what starts this rule.";
  switch (trigger.type) {
    case "TASK_ADDED":
    case "MOVED_TO_SECTION":
      return trigger.sectionId && !ctx.sectionIds.includes(trigger.sectionId) ? "Choose a section of this project (or any section)." : null;
    case "FIELD_CHANGED": {
      if (!trigger.field) return "Choose the field.";
      if ((BUILT_IN_FIELDS as readonly string[]).includes(trigger.field)) {
        if (trigger.field === "priority" && trigger.value && !(TASK_PRIORITIES as readonly string[]).includes(String(trigger.value))) return "Choose a priority.";
        return null;
      }
      const field = ctx.fields.find((item) => item.id === fieldIdOf(trigger.field));
      if (!field || !conditionField(field)) return "Choose a field of this project.";
      if (trigger.value !== null && trigger.value !== undefined && trigger.value !== "" && (field.type === "SELECT" || field.type === "MULTI_SELECT") && !field.options.some((option) => option.id === Number(trigger.value))) return "Choose one of the field's options.";
      return null;
    }
    case "STATUS_CHANGED":
      return trigger.status ? null : "Choose which status change.";
    case "ASSIGNEE_CHANGED":
      return trigger.userId && !ctx.activePeople.has(trigger.userId) ? "Choose an active person (or anyone)." : null;
    case "DUE_APPROACHING":
      return trigger.days === undefined ? "Say how many days before the due date." : null;
    case "FORM_SUBMITTED":
      return trigger.formId && !ctx.formIds.includes(trigger.formId) ? "Choose a form of this project (or any form)." : null;
    case "SCHEDULED": {
      if (!trigger.frequency) return "Choose daily or weekly.";
      if (trigger.frequency === "WEEKLY" && trigger.weekday === undefined) return "Choose the day of the week.";
      if (!trigger.time) return "Choose the time.";
      for (const condition of trigger.filter ?? []) {
        const problem = checkCondition(condition, ctx);
        if (problem) return `Which tasks: ${problem}`;
      }
      return null;
    }
    case "WEBHOOK":
      if (!trigger.webhookMode) return "Choose whether a request creates a task or updates one.";
      if (trigger.webhookMode === "CREATE" && trigger.sectionId && !ctx.sectionIds.includes(trigger.sectionId)) return "Choose a section of this project.";
      if (trigger.assigneeId && !ctx.activePeople.has(trigger.assigneeId)) return "Choose an active person.";
      return null;
    default:
      return null;
  }
}

export function checkStep(step: Step, ctx: CheckContext): string | null {
  switch (step.type) {
    case "MOVE_TO_SECTION":
      return step.sectionId && ctx.sectionIds.includes(step.sectionId) ? null : "Choose a section of this project.";
    case "ADD_TO_PROJECT": {
      if (!step.projectId) return "Choose the project.";
      const sections = ctx.targetProjects.get(step.projectId);
      if (!sections) return "The rule's owner must be an owner or editor of that project.";
      return step.sectionId && !sections.includes(step.sectionId) ? "Choose a section of that project." : null;
    }
    case "SET_STATUS":
      return step.status ? null : "Choose complete or incomplete.";
    case "SET_ASSIGNEE":
      return step.userId && ctx.activePeople.has(step.userId) ? null : "Choose one active person (a task has exactly one assignee).";
    case "SET_DUE":
      return step.days === undefined ? "Say how many days from the day the rule runs." : null;
    case "SET_PRIORITY":
      return step.priority && (TASK_PRIORITIES as readonly string[]).includes(step.priority) ? null : "Choose a priority.";
    case "SET_FIELD": {
      const field = ctx.fields.find((item) => item.id === step.fieldId);
      if (!field || !writableField(field)) return "Choose a field of this project that can be typed.";
      const value = step.value;
      if (value === undefined) return "Choose the value (or leave it empty to clear the field).";
      if ((field.type === "SELECT" || field.type === "MULTI_SELECT") && value !== null && value !== "") {
        const ids = Array.isArray(value) ? value : [Number(value)];
        if (ids.some((option) => !field.options.some((item) => item.id === option && !item.archived))) return "Choose from the field's options.";
      }
      if (field.type === "PEOPLE" && Array.isArray(value) && value.some((person) => !ctx.activePeople.has(person))) return "Choose active people.";
      if (field.type === "NUMBER" && value !== null && value !== "" && !Number.isFinite(Number(value))) return "Enter a number.";
      if (field.type === "DATE" && value !== null && value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "Choose a date.";
      return null;
    }
    case "CREATE_TASK":
      if (!step.title?.trim()) return "Write the new task's name.";
      if (step.sectionId && !ctx.sectionIds.includes(step.sectionId)) return "Choose a section of this project.";
      if (step.userId && !ctx.activePeople.has(step.userId)) return "Choose an active person.";
      return null;
    case "CREATE_SUBTASKS": {
      const titles = (step.titles ?? []).map((title) => title.trim()).filter(Boolean);
      if (!titles.length) return "Write at least one subtask name, one per line.";
      if (titles.length > MAX_SUBTASKS) return `At most ${MAX_SUBTASKS} subtasks.`;
      if (step.userId && !ctx.activePeople.has(step.userId)) return "Choose an active person.";
      return null;
    }
    case "ADD_COMMENT":
      return step.text?.trim() ? null : "Write the comment.";
    case "ADD_COLLABORATORS":
      if (!step.userIds?.length) return "Choose at least one person.";
      return step.userIds.every((person) => ctx.activePeople.has(person)) ? null : "Choose active people.";
    case "NOTIFY":
      if (!step.text?.trim()) return "Write the message.";
      if (!(step.userIds?.length || step.targets?.length)) return "Choose who to tell.";
      return (step.userIds ?? []).every((person) => ctx.activePeople.has(person)) ? null : "Choose active people.";
  }
}

export function checkRule(name: string, def: RuleDefinition, ctx: CheckContext): RuleProblem[] {
  const problems: RuleProblem[] = [];
  if (!name.trim()) problems.push({ where: "name", message: "Give the rule a name." });
  const trigger = checkTrigger(def.trigger, ctx);
  if (trigger) problems.push({ where: "trigger", message: trigger });
  const count = allSteps(def).length;
  if (count === 0) problems.push({ where: "rule", message: "Add at least one step." });
  if (count > ctx.maxSteps) problems.push({ where: "rule", message: `A rule has at most ${ctx.maxSteps} steps (Admin → Task settings).` });
  const keys = new Set<string>();
  for (const step of allSteps(def)) {
    if (keys.has(step.key)) problems.push({ where: `step:${step.key}`, message: "Two steps share a key; remove one and add it again." });
    keys.add(step.key);
    const problem = checkStep(step, ctx);
    if (problem) problems.push({ where: `step:${step.key}`, message: problem });
  }
  def.paths.forEach((path, index) => {
    if (!path.name.trim()) problems.push({ where: `path:${path.key}`, message: `Name path ${index + 1}.` });
    if (!path.conditions.length) problems.push({ where: `path:${path.key}`, message: "Add at least one condition (or use Otherwise)." });
    for (const condition of path.conditions) {
      const problem = checkCondition(condition, ctx);
      if (problem) {
        problems.push({ where: `path:${path.key}`, message: problem });
        break;
      }
    }
  });
  if (!def.paths.length && def.otherwise.length) problems.push({ where: "rule", message: "Otherwise steps need at least one path above them." });
  return problems;
}

// ---- task facts and conditions -----------------------------------------------------------------
export interface FieldFact {
  type: string;
  text: string | null;
  number: number | null;
  date: string | null;
  optionId: number | null;
  ids: number[] | null;
}
export interface TaskFacts {
  sectionId: number | null; // in the rule's project
  assigneeId: number;
  priority: string;
  dueDay: string | null; // India day
  status: string;
  title: string;
  fields: ReadonlyMap<number, FieldFact>;
}
export function dueStatus(facts: Pick<TaskFacts, "status" | "dueDay">, today: string): DueStatus {
  if (facts.status === "COMPLETED") return "DONE";
  if (!facts.dueDay) return "NONE";
  if (facts.dueDay < today) return "OVERDUE";
  if (facts.dueDay === today) return "TODAY";
  if (facts.dueDay <= addDays(today, 7)) return "SOON";
  return "LATER";
}
const completionOf = (status: string) => (status === "COMPLETED" ? "COMPLETE" : status === "BLOCKED" ? "BLOCKED" : "INCOMPLETE");
const isSet = (fact: FieldFact | undefined) => Boolean(fact && (fact.text || fact.number !== null || fact.date || fact.optionId !== null || (fact.ids && fact.ids.length)));

function compareField(fact: FieldFact | undefined, op: Op, value: unknown): boolean {
  if (op === "IS_SET") return isSet(fact);
  if (op === "IS_NOT_SET") return !isSet(fact);
  if (!fact) return op === "IS_NOT";
  switch (fact.type) {
    case "SELECT":
      return op === "IS" ? fact.optionId === Number(value) : op === "IS_NOT" ? fact.optionId !== Number(value) : false;
    case "MULTI_SELECT":
    case "PEOPLE":
      return op === "CONTAINS" ? (fact.ids ?? []).includes(Number(value)) : false;
    case "DATE": {
      if (!fact.date) return false;
      const day = String(value);
      return op === "IS" ? fact.date === day : op === "GT" ? fact.date > day : op === "LT" ? fact.date < day : false;
    }
    case "NUMBER":
    case "FORMULA":
    case "TIMER": {
      if (fact.number === null) return false;
      const n = Number(value);
      return op === "IS" ? fact.number === n : op === "GT" ? fact.number > n : op === "LT" ? fact.number < n : false;
    }
    default: {
      const text = (fact.text ?? "").toLowerCase();
      const want = String(value ?? "").toLowerCase();
      return op === "IS" ? text === want : op === "CONTAINS" ? text.includes(want) : false;
    }
  }
}

export function conditionMatches(condition: Condition, facts: TaskFacts, today: string): boolean {
  const is = (actual: unknown) => (condition.op === "IS" ? String(actual) === String(condition.value) : condition.op === "IS_NOT" ? String(actual) !== String(condition.value) : false);
  switch (condition.subject) {
    case "SECTION":
      return is(facts.sectionId);
    case "ASSIGNEE":
      return is(facts.assigneeId);
    case "PRIORITY":
      return is(facts.priority);
    case "DUE_STATUS":
      return is(dueStatus(facts, today));
    case "COMPLETION":
      return is(completionOf(facts.status));
    case "NAME": {
      const title = facts.title.toLowerCase();
      const want = String(condition.value ?? "").toLowerCase();
      return condition.op === "IS" ? title === want : condition.op === "CONTAINS" ? title.includes(want) : false;
    }
    case "FIELD":
      return compareField(condition.fieldId ? facts.fields.get(condition.fieldId) : undefined, condition.op, condition.value);
  }
}
export function conditionsMatch(conditions: readonly Condition[], match: "ALL" | "ANY", facts: TaskFacts, today: string): boolean {
  if (!conditions.length) return true;
  return match === "ALL" ? conditions.every((condition) => conditionMatches(condition, facts, today)) : conditions.some((condition) => conditionMatches(condition, facts, today));
}
// BR-AUTO-009: paths are tried top-down; the first match runs, else Otherwise.
export function choosePath(def: RuleDefinition, facts: TaskFacts, today: string): { index: number; path: Path | null; steps: Step[] } {
  for (let index = 0; index < def.paths.length; index += 1) {
    const path = def.paths[index]!;
    if (conditionsMatch(path.conditions, path.match, facts, today)) return { index, path, steps: path.steps };
  }
  return { index: -1, path: null, steps: def.otherwise };
}

// ---- matching an event to a trigger --------------------------------------------------------------
export interface AutomationEvent {
  id: number;
  taskId: number;
  type: string; // the task event type (CREATED, MOVED_SECTION, EDIT, …) or ATTACHMENT_ADDED
  fromStatus: string | null;
  toStatus: string | null;
  payload: Record<string, unknown> | null;
  actorId: number | null;
  depth: number;
  chain: number[];
}
// The fields an EDIT event changed (setTaskFields says so; actOnTask's EDIT
// has before/after; a shifted or moved due date says dueChanged).
export function changedFields(event: Pick<AutomationEvent, "type" | "payload">): string[] {
  const payload = event.payload ?? {};
  if (event.type === "FIELD_SET") return typeof payload.fieldId === "number" ? [fieldKey(payload.fieldId)] : [];
  if (event.type !== "EDIT") return [];
  if (Array.isArray(payload.changed)) return payload.changed.filter((item): item is string => typeof item === "string");
  const before = payload.before as Record<string, unknown> | undefined;
  const after = payload.after as Record<string, unknown> | undefined;
  const out = new Set<string>();
  if (before && after) {
    if (before.title !== after.title) out.add("name");
    if (before.priority !== after.priority) out.add("priority");
    if (before.dueAt !== after.dueAt) out.add("due");
  }
  if (payload.dueChanged) out.add("due");
  return [...out];
}

// Does this (already committed) event start this trigger, for a task whose
// facts in the rule's project are given? Section, field and form checks are
// made against the payload or the facts.
export function eventMatches(trigger: Trigger, event: AutomationEvent, projectId: number, facts: TaskFacts): boolean {
  const payload = event.payload ?? {};
  switch (trigger.type) {
    case "TASK_ADDED": {
      const added = event.type === "CREATED" || (event.type === "ADDED_TO_PROJECT" && payload.projectId === projectId);
      return added && (!trigger.sectionId || facts.sectionId === trigger.sectionId);
    }
    case "MOVED_TO_SECTION":
      return event.type === "MOVED_SECTION" && payload.projectId === projectId && (!trigger.sectionId || payload.sectionId === trigger.sectionId);
    case "FIELD_CHANGED": {
      if (!trigger.field || !changedFields(event).includes(trigger.field)) return false;
      if (trigger.value === null || trigger.value === undefined || trigger.value === "") return true;
      if (trigger.field === "priority") return facts.priority === trigger.value;
      if (trigger.field === "name") return facts.title.toLowerCase() === String(trigger.value).toLowerCase();
      if (trigger.field === "due") return facts.dueDay === trigger.value;
      const field = fieldIdOf(trigger.field);
      if (field === null) return false;
      const fact = facts.fields.get(field);
      const op: Op = fact && (fact.type === "MULTI_SELECT" || fact.type === "PEOPLE") ? "CONTAINS" : "IS";
      return compareField(fact, op, trigger.value);
    }
    case "STATUS_CHANGED": {
      if (!event.toStatus || event.fromStatus === event.toStatus) return false;
      if (event.type === "DELETED" || event.type === "RESTORED" || event.type === "CANCEL") return false;
      const status = trigger.status ?? "ANY";
      if (status === "COMPLETED") return event.toStatus === "COMPLETED";
      if (status === "INCOMPLETE") return event.fromStatus === "COMPLETED" && event.toStatus !== "COMPLETED" && event.toStatus !== "CANCELLED";
      if (status === "BLOCKED") return event.toStatus === "BLOCKED";
      return true;
    }
    case "ASSIGNEE_CHANGED":
      return event.type === "REASSIGN" && (!trigger.userId || payload.to === trigger.userId);
    case "ATTACHMENT_ADDED":
      return event.type === "ATTACHMENT_ADDED";
    case "COMMENT_ADDED":
      return event.type === "COMMENTED" || event.type === "COMMENT";
    case "COLLABORATOR_ADDED":
      return event.type === "FOLLOWER_ADDED";
    case "FORM_SUBMITTED":
      return event.type === "FORM_SUBMITTED" && (!trigger.formId || payload.formId === trigger.formId);
    default:
      return false; // MANUAL, SCHEDULED, WEBHOOK, DUE_APPROACHING and OVERDUE don't come from events
  }
}
// The event types the engine listens to (the outbox stores only these).
export const LISTENED_EVENTS: ReadonlySet<string> = new Set(["CREATED", "ADDED_TO_PROJECT", "MOVED_SECTION", "EDIT", "FIELD_SET", "START", "BLOCK", "UNBLOCK", "COMPLETE", "REOPEN", "REASSIGN", "COMMENTED", "COMMENT", "FOLLOWER_ADDED", "FORM_SUBMITTED", "ATTACHMENT_ADDED"]);

// ---- loop protection and caps ---------------------------------------------------------------------
// A rule's own changes never start it again (anywhere in the chain), and a
// chain stops after MAX_CHAIN_DEPTH rules.
export function chainCheck(event: Pick<AutomationEvent, "depth" | "chain">, ruleId: number, maxDepth = MAX_CHAIN_DEPTH): "OK" | "OWN" | "DEPTH" {
  if (event.chain.includes(ruleId)) return "OWN";
  if (event.depth + 1 > maxDepth) return "DEPTH";
  return "OK";
}
// The per-rule hourly window: a new window starts an hour after the last one began.
export function hourWindow(start: Date | null, runs: number, now: Date, cap = RUNS_PER_HOUR): { allowed: boolean; reset: boolean } {
  const reset = !start || now.getTime() - start.getTime() >= 3_600_000;
  const used = reset ? 0 : runs;
  return { allowed: used < cap, reset };
}

// ---- scheduled triggers ----------------------------------------------------------------------------
// India wall clock: is a Scheduled trigger due now (and not yet run today)?
export function scheduleDue(trigger: Trigger, nowIndia: { day: string; weekday: number; time: string }, lastDay: string | null): boolean {
  if (trigger.type !== "SCHEDULED" || !trigger.time || !trigger.frequency) return false;
  if (lastDay === nowIndia.day) return false;
  if (trigger.frequency === "WEEKLY" && trigger.weekday !== nowIndia.weekday) return false;
  return nowIndia.time >= trigger.time;
}
export function indiaClock(now: Date): { day: string; weekday: number; time: string } {
  const local = new Date(now.getTime() + 330 * 60_000);
  return { day: local.toISOString().slice(0, 10), weekday: local.getUTCDay(), time: local.toISOString().slice(11, 16) };
}

// ---- words ------------------------------------------------------------------------------------------
export interface Names {
  sections: ReadonlyMap<number, string>;
  people: ReadonlyMap<number, string>;
  fields: ReadonlyMap<number, FieldInfo>;
  projects: ReadonlyMap<number, string>;
  forms: ReadonlyMap<number, string>;
}
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const priorityText = (code: string) => PRIORITY_LABEL[code as TaskPriority] ?? code;
export function describeTrigger(trigger: Trigger | null, names: Names): string {
  if (!trigger) return "Choose a trigger";
  const section = (id: number | null | undefined) => (id ? `“${names.sections.get(id) ?? "a section"}”` : "any section");
  switch (trigger.type) {
    case "TASK_ADDED":
      return trigger.sectionId ? `Task is added to this project in ${section(trigger.sectionId)}` : "Task is added to this project";
    case "MOVED_TO_SECTION":
      return `Task is moved to ${section(trigger.sectionId)}`;
    case "FIELD_CHANGED": {
      const builtIn = (BUILT_IN_FIELDS as readonly string[]).includes(trigger.field ?? "") ? BUILT_IN_FIELD_LABEL[trigger.field as BuiltInField] : null;
      const field = builtIn ?? names.fields.get(fieldIdOf(trigger.field) ?? 0)?.name ?? "a field";
      const value = trigger.value === null || trigger.value === undefined || trigger.value === "" ? "" : ` to ${trigger.field === "priority" ? priorityText(String(trigger.value)) : (names.fields.get(fieldIdOf(trigger.field) ?? 0)?.options.find((option) => option.id === Number(trigger.value))?.name ?? String(trigger.value))}`;
      return `${field} is changed${value}`;
    }
    case "STATUS_CHANGED":
      return `Completion status: ${STATUS_TRIGGER_LABEL[trigger.status ?? "ANY"].toLowerCase()}`;
    case "ASSIGNEE_CHANGED":
      return trigger.userId ? `Task is assigned to ${names.people.get(trigger.userId) ?? "someone"}` : "Task is assigned (to anyone)";
    case "DUE_APPROACHING":
      return trigger.days === 0 ? "Due date is today" : `Due date is ${trigger.days ?? "?"} day${trigger.days === 1 ? "" : "s"} away`;
    case "FORM_SUBMITTED":
      return trigger.formId ? `Form “${names.forms.get(trigger.formId) ?? "a form"}” is submitted` : "Any form of this project is submitted";
    case "SCHEDULED":
      return `${trigger.frequency === "WEEKLY" ? `Every ${WEEKDAYS[trigger.weekday ?? 1]}` : "Every day"} at ${trigger.time ?? "?"} (India), for the tasks that match`;
    case "WEBHOOK":
      return trigger.webhookMode === "UPDATE" ? "A web request updates a task" : "A web request creates a task";
    default:
      return TRIGGER_LABEL[trigger.type];
  }
}
export function describeStep(step: Step, names: Names): string {
  const people = (ids: readonly number[] | undefined) => (ids ?? []).map((person) => names.people.get(person) ?? "someone").join(", ");
  switch (step.type) {
    case "MOVE_TO_SECTION":
      return `Move to “${names.sections.get(step.sectionId ?? 0) ?? "?"}”`;
    case "ADD_TO_PROJECT":
      return `Add to the project “${names.projects.get(step.projectId ?? 0) ?? "?"}”`;
    case "SET_STATUS":
      return step.status === "REOPEN" ? "Mark incomplete" : "Mark complete";
    case "SET_ASSIGNEE":
      return `Assign to ${names.people.get(step.userId ?? 0) ?? "?"}`;
    case "SET_DUE":
      return `Due ${step.days ?? "?"} ${step.workingDays ? "working " : ""}day${step.days === 1 ? "" : "s"} after the rule runs`;
    case "SET_PRIORITY":
      return `Priority ${priorityText(step.priority ?? "")}`;
    case "SET_FIELD": {
      const field = names.fields.get(step.fieldId ?? 0);
      const value = step.value === null || step.value === "" ? "empty" : Array.isArray(step.value) ? step.value.map((option) => field?.options.find((item) => item.id === option)?.name ?? names.people.get(option) ?? String(option)).join(", ") : (field?.options.find((item) => item.id === Number(step.value))?.name ?? String(step.value ?? ""));
      return `Set ${field?.name ?? "a field"} to ${value}`;
    }
    case "CREATE_TASK":
      return `Create the task “${step.title ?? ""}”`;
    case "CREATE_SUBTASKS":
      return `Create ${(step.titles ?? []).filter((title) => title.trim()).length} subtask(s)`;
    case "ADD_COMMENT":
      return "Add a comment";
    case "ADD_COLLABORATORS":
      return `Add ${people(step.userIds)} as collaborators`;
    case "NOTIFY":
      return `Notify ${[...(step.targets ?? []).map((target) => NOTIFY_TARGET_LABEL[target].toLowerCase()), people(step.userIds)].filter(Boolean).join(", ")}`;
  }
}
