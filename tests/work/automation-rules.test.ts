import { describe, expect, it } from "vitest";
import {
  chainCheck,
  changedFields,
  checkRule,
  checkStep,
  choosePath,
  conditionMatches,
  conditionsMatch,
  describeTrigger,
  dueStatus,
  eventMatches,
  hourWindow,
  indiaClock,
  MAX_CHAIN_DEPTH,
  opsFor,
  parseAutomationLimits,
  parseDefinition,
  scheduleDue,
  type AutomationEvent,
  type CheckContext,
  type FieldFact,
  type RuleDefinition,
  type TaskFacts,
} from "@/server/work/automation-rules";
import { signBody, verifyWebhook } from "@/server/work/automation-webhook";

// v1.68.0 (D-380): the pure rules of project automations: checking a rule,
// conditions, choosing a path, matching events, loop and rate guards, the
// schedule, and webhook signatures.
const ctx: CheckContext = {
  sectionIds: [10, 11, 12],
  fields: [
    { id: 1, name: "Stage", type: "SELECT", options: [{ id: 101, name: "New", archived: false }, { id: 102, name: "Old", archived: true }] },
    { id: 2, name: "Cost", type: "NUMBER", options: [] },
    { id: 3, name: "Tags", type: "MULTI_SELECT", options: [{ id: 301, name: "A", archived: false }] },
    { id: 4, name: "Ref", type: "ID", options: [] },
  ],
  formIds: [7],
  activePeople: new Set([50, 51]),
  targetProjects: new Map([[90, [900, 901]]]),
  maxSteps: 3,
};
const fact = (type: string, patch: Partial<FieldFact> = {}): FieldFact => ({ type, text: null, number: null, date: null, optionId: null, ids: null, ...patch });
const facts = (patch: Partial<TaskFacts> = {}): TaskFacts => ({
  sectionId: 10,
  assigneeId: 50,
  priority: "NORMAL",
  dueDay: "2026-11-25",
  status: "OPEN",
  title: "Fix the pump",
  fields: new Map<number, FieldFact>([
    [1, fact("SELECT", { optionId: 101 })],
    [2, fact("NUMBER", { number: 1200 })],
    [3, fact("MULTI_SELECT", { ids: [301] })],
  ]),
  ...patch,
});
const event = (patch: Partial<AutomationEvent>): AutomationEvent => ({ id: 1, taskId: 5, type: "EDIT", fromStatus: "OPEN", toStatus: "OPEN", payload: null, actorId: 50, depth: 0, chain: [], ...patch });
const rule = (patch: Partial<RuleDefinition>): RuleDefinition => ({ trigger: { type: "MOVED_TO_SECTION", sectionId: 11 }, steps: [{ key: "s1", type: "SET_PRIORITY", priority: "URGENT" }], paths: [], otherwise: [], ...patch });

describe("checking a rule (Publish needs no problems)", () => {
  it("accepts a complete rule", () => {
    expect(checkRule("Move", rule({}), ctx)).toEqual([]);
  });
  it("needs a name, a trigger and a step, within the step limit", () => {
    const problems = checkRule(" ", { trigger: null, steps: [], paths: [], otherwise: [] }, ctx);
    expect(problems.map((problem) => problem.where)).toEqual(["name", "trigger", "rule"]);
    const many = rule({ steps: ["a", "b", "c", "d"].map((key) => ({ key, type: "SET_PRIORITY" as const, priority: "HIGH" })) });
    expect(checkRule("Many", many, ctx).some((problem) => /at most 3 steps/.test(problem.message))).toBe(true);
  });
  it("checks each trigger's settings", () => {
    expect(checkRule("x", rule({ trigger: { type: "MOVED_TO_SECTION", sectionId: 99 } }), ctx)[0]).toMatchObject({ where: "trigger" });
    expect(checkRule("x", rule({ trigger: { type: "FIELD_CHANGED", field: "f1", value: 999 } }), ctx)[0]?.message).toMatch(/options/);
    expect(checkRule("x", rule({ trigger: { type: "FIELD_CHANGED", field: "priority", value: "NOPE" } }), ctx)[0]?.message).toMatch(/priority/);
    expect(checkRule("x", rule({ trigger: { type: "SCHEDULED", frequency: "WEEKLY", time: "09:00" } }), ctx)[0]?.message).toMatch(/day of the week/);
    expect(checkRule("x", rule({ trigger: { type: "WEBHOOK" } }), ctx)[0]?.message).toMatch(/creates a task or updates/);
    expect(checkRule("x", rule({ trigger: { type: "FORM_SUBMITTED", formId: 8 } }), ctx)[0]?.where).toBe("trigger");
    expect(checkRule("x", rule({ trigger: { type: "DUE_APPROACHING", days: 2 } }), ctx)).toEqual([]);
  });
  it("validates every step type", () => {
    expect(checkStep({ key: "a", type: "MOVE_TO_SECTION", sectionId: 99 }, ctx)).toMatch(/section/);
    expect(checkStep({ key: "a", type: "ADD_TO_PROJECT", projectId: 91 }, ctx)).toMatch(/owner or editor/);
    expect(checkStep({ key: "a", type: "ADD_TO_PROJECT", projectId: 90, sectionId: 999 }, ctx)).toMatch(/section of that project/);
    expect(checkStep({ key: "a", type: "ADD_TO_PROJECT", projectId: 90, sectionId: 900 }, ctx)).toBeNull();
    expect(checkStep({ key: "a", type: "SET_ASSIGNEE" }, ctx)).toMatch(/exactly one assignee/);
    expect(checkStep({ key: "a", type: "SET_ASSIGNEE", userId: 77 }, ctx)).toMatch(/active/);
    expect(checkStep({ key: "a", type: "SET_FIELD", fieldId: 4, value: "x" }, ctx)).toMatch(/can be typed/); // an ID field is read-only
    expect(checkStep({ key: "a", type: "SET_FIELD", fieldId: 1, value: 102 }, ctx)).toMatch(/options/); // archived
    expect(checkStep({ key: "a", type: "SET_FIELD", fieldId: 1, value: null }, ctx)).toBeNull(); // clears
    expect(checkStep({ key: "a", type: "SET_FIELD", fieldId: 2, value: "abc" }, ctx)).toMatch(/number/);
    expect(checkStep({ key: "a", type: "CREATE_SUBTASKS", titles: [" ", ""] }, ctx)).toMatch(/at least one/);
    expect(checkStep({ key: "a", type: "ADD_COMMENT", text: "  " }, ctx)).toMatch(/comment/);
    expect(checkStep({ key: "a", type: "NOTIFY", text: "Hi" }, ctx)).toMatch(/who to tell/);
    expect(checkStep({ key: "a", type: "NOTIFY", text: "Hi", targets: ["ASSIGNEE"] }, ctx)).toBeNull();
    expect(checkStep({ key: "a", type: "SET_DUE", days: 3, workingDays: true }, ctx)).toBeNull();
  });
  it("checks paths: a name, conditions, valid values; Otherwise needs a path", () => {
    const def = rule({ paths: [{ key: "p1", name: "", match: "ALL", conditions: [], steps: [] }] });
    expect(checkRule("x", def, ctx).map((problem) => problem.message)).toEqual(expect.arrayContaining(["Name path 1.", "Add at least one condition (or use Otherwise)."]));
    const bad = rule({ paths: [{ key: "p1", name: "Big", match: "ALL", conditions: [{ subject: "SECTION", op: "IS", value: 99 }], steps: [] }] });
    expect(checkRule("x", bad, ctx).some((problem) => problem.where === "path:p1")).toBe(true);
    expect(checkRule("x", rule({ otherwise: [{ key: "o", type: "ADD_COMMENT", text: "x" }] }), ctx).some((problem) => /Otherwise/.test(problem.message))).toBe(true);
  });
  it("reads stored JSON safely and the Admin limits with defaults", () => {
    expect(parseDefinition("not json")).toEqual({ trigger: null, steps: [], paths: [], otherwise: [] });
    expect(parseDefinition({ trigger: { type: "NOPE" }, steps: [], paths: [], otherwise: [] }).trigger).toBeNull();
    expect(parseAutomationLimits(null)).toEqual({ perProject: 50, stepsPerRule: 20 });
    expect(parseAutomationLimits('{"perProject": 10}')).toEqual({ perProject: 10, stepsPerRule: 20 });
    expect(parseAutomationLimits('{"perProject": 0}')).toEqual({ perProject: 50, stepsPerRule: 20 });
  });
});

describe("conditions", () => {
  const today = "2026-11-22";
  it("compares the task's own facts", () => {
    expect(conditionMatches({ subject: "SECTION", op: "IS", value: 10 }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "SECTION", op: "IS_NOT", value: 10 }, facts(), today)).toBe(false);
    expect(conditionMatches({ subject: "ASSIGNEE", op: "IS", value: 50 }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "PRIORITY", op: "IS", value: "URGENT" }, facts(), today)).toBe(false);
    expect(conditionMatches({ subject: "NAME", op: "CONTAINS", value: "PUMP" }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "COMPLETION", op: "IS", value: "INCOMPLETE" }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "COMPLETION", op: "IS", value: "COMPLETE" }, facts({ status: "COMPLETED" }), today)).toBe(true);
  });
  it("works out the due date status", () => {
    expect(dueStatus({ status: "OPEN", dueDay: "2026-11-21" }, today)).toBe("OVERDUE");
    expect(dueStatus({ status: "OPEN", dueDay: today }, today)).toBe("TODAY");
    expect(dueStatus({ status: "OPEN", dueDay: "2026-11-29" }, today)).toBe("SOON");
    expect(dueStatus({ status: "OPEN", dueDay: "2026-11-30" }, today)).toBe("LATER");
    expect(dueStatus({ status: "OPEN", dueDay: null }, today)).toBe("NONE");
    expect(dueStatus({ status: "COMPLETED", dueDay: "2026-01-01" }, today)).toBe("DONE");
    expect(conditionMatches({ subject: "DUE_STATUS", op: "IS", value: "SOON" }, facts(), today)).toBe(true);
  });
  it("compares custom fields by type, including empty ones", () => {
    expect(conditionMatches({ subject: "FIELD", fieldId: 1, op: "IS", value: 101 }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "FIELD", fieldId: 2, op: "GT", value: 1000 }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "FIELD", fieldId: 2, op: "LT", value: 1000 }, facts(), today)).toBe(false);
    expect(conditionMatches({ subject: "FIELD", fieldId: 3, op: "CONTAINS", value: 301 }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "FIELD", fieldId: 9, op: "IS_NOT_SET" }, facts(), today)).toBe(true);
    expect(conditionMatches({ subject: "FIELD", fieldId: 2, op: "IS_SET" }, facts(), today)).toBe(true);
  });
  it("joins with all / any; no conditions match everything", () => {
    const yes = { subject: "SECTION" as const, op: "IS" as const, value: 10 };
    const no = { subject: "PRIORITY" as const, op: "IS" as const, value: "URGENT" };
    expect(conditionsMatch([yes, no], "ALL", facts(), today)).toBe(false);
    expect(conditionsMatch([yes, no], "ANY", facts(), today)).toBe(true);
    expect(conditionsMatch([], "ALL", facts(), today)).toBe(true);
  });
  it("offers only the operators that fit", () => {
    expect(opsFor("FIELD", "MULTI_SELECT")).toEqual(["CONTAINS", "IS_SET", "IS_NOT_SET"]);
    expect(opsFor("FIELD", "LOOKUP")).toEqual(["IS_SET", "IS_NOT_SET"]);
    expect(opsFor("PRIORITY")).toEqual(["IS", "IS_NOT"]);
  });
});

describe("choosing a path (BR-AUTO-009: first match, else Otherwise)", () => {
  const def = rule({
    paths: [
      { key: "p1", name: "Urgent", match: "ALL", conditions: [{ subject: "PRIORITY", op: "IS", value: "URGENT" }], steps: [{ key: "a", type: "ADD_COMMENT", text: "urgent" }] },
      { key: "p2", name: "Big", match: "ALL", conditions: [{ subject: "FIELD", fieldId: 2, op: "GT", value: 1000 }], steps: [{ key: "b", type: "ADD_COMMENT", text: "big" }] },
      { key: "p3", name: "Also big", match: "ALL", conditions: [{ subject: "FIELD", fieldId: 2, op: "GT", value: 10 }], steps: [] },
    ],
    otherwise: [{ key: "c", type: "ADD_COMMENT", text: "other" }],
  });
  it("runs the first path that matches, top-down", () => {
    expect(choosePath(def, facts(), "2026-11-22")).toMatchObject({ index: 1, path: { name: "Big" } });
    expect(choosePath(def, facts({ priority: "URGENT" }), "2026-11-22").index).toBe(0);
  });
  it("falls back to Otherwise", () => {
    const chosen = choosePath(def, facts({ fields: new Map() }), "2026-11-22");
    expect(chosen).toMatchObject({ index: -1, path: null });
    expect(chosen.steps.map((step) => step.key)).toEqual(["c"]);
  });
});

describe("matching events to triggers", () => {
  it("task added to the project (in a section) and moved to a section", () => {
    expect(eventMatches({ type: "TASK_ADDED" }, event({ type: "CREATED" }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "TASK_ADDED", sectionId: 11 }, event({ type: "CREATED" }), 3, facts())).toBe(false);
    expect(eventMatches({ type: "TASK_ADDED" }, event({ type: "ADDED_TO_PROJECT", payload: { projectId: 4 } }), 3, facts())).toBe(false);
    expect(eventMatches({ type: "MOVED_TO_SECTION", sectionId: 11 }, event({ type: "MOVED_SECTION", payload: { projectId: 3, sectionId: 11 } }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "MOVED_TO_SECTION", sectionId: 11 }, event({ type: "MOVED_SECTION", payload: { projectId: 4, sectionId: 11 } }), 3, facts())).toBe(false);
    expect(eventMatches({ type: "MOVED_TO_SECTION" }, event({ type: "MOVED_SECTION", payload: { projectId: 3, sectionId: 12 } }), 3, facts())).toBe(true);
  });
  it("field changed, optionally to a value", () => {
    expect(changedFields(event({ type: "EDIT", payload: { changed: ["due", "priority"] } }))).toEqual(["due", "priority"]);
    expect(changedFields(event({ type: "EDIT", payload: { before: { title: "a", priority: "LOW", dueAt: null }, after: { title: "b", priority: "LOW", dueAt: null } } }))).toEqual(["name"]);
    expect(changedFields(event({ type: "FIELD_SET", payload: { fieldId: 1 } }))).toEqual(["f1"]);
    expect(eventMatches({ type: "FIELD_CHANGED", field: "priority" }, event({ payload: { changed: ["priority"] } }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "FIELD_CHANGED", field: "priority", value: "URGENT" }, event({ payload: { changed: ["priority"] } }), 3, facts())).toBe(false);
    expect(eventMatches({ type: "FIELD_CHANGED", field: "f1", value: 101 }, event({ type: "FIELD_SET", payload: { fieldId: 1 } }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "FIELD_CHANGED", field: "f3", value: 301 }, event({ type: "FIELD_SET", payload: { fieldId: 3 } }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "FIELD_CHANGED", field: "f2" }, event({ type: "FIELD_SET", payload: { fieldId: 1 } }), 3, facts())).toBe(false);
  });
  it("completion status, assignee, comments, collaborators, attachments, forms", () => {
    expect(eventMatches({ type: "STATUS_CHANGED", status: "COMPLETED" }, event({ type: "COMPLETE", fromStatus: "OPEN", toStatus: "COMPLETED" }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "STATUS_CHANGED", status: "INCOMPLETE" }, event({ type: "REOPEN", fromStatus: "COMPLETED", toStatus: "OPEN" }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "STATUS_CHANGED", status: "BLOCKED" }, event({ type: "BLOCK", fromStatus: "OPEN", toStatus: "BLOCKED" }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "STATUS_CHANGED", status: "ANY" }, event({ type: "EDIT" }), 3, facts())).toBe(false);
    expect(eventMatches({ type: "ASSIGNEE_CHANGED", userId: 51 }, event({ type: "REASSIGN", payload: { from: 50, to: 51 } }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "ASSIGNEE_CHANGED", userId: 52 }, event({ type: "REASSIGN", payload: { from: 50, to: 51 } }), 3, facts())).toBe(false);
    expect(eventMatches({ type: "COMMENT_ADDED" }, event({ type: "COMMENTED" }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "COLLABORATOR_ADDED" }, event({ type: "FOLLOWER_ADDED" }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "ATTACHMENT_ADDED" }, event({ type: "ATTACHMENT_ADDED" }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "FORM_SUBMITTED", formId: 7 }, event({ type: "FORM_SUBMITTED", payload: { formId: 7 } }), 3, facts())).toBe(true);
    expect(eventMatches({ type: "FORM_SUBMITTED", formId: 8 }, event({ type: "FORM_SUBMITTED", payload: { formId: 7 } }), 3, facts())).toBe(false);
    expect(eventMatches({ type: "MANUAL" }, event({ type: "CREATED" }), 3, facts())).toBe(false);
  });
});

describe("loop protection and caps", () => {
  it("a rule's own changes never start it again; a chain stops after 3 rules", () => {
    expect(chainCheck({ depth: 0, chain: [] }, 7)).toBe("OK");
    expect(chainCheck({ depth: 1, chain: [7] }, 7)).toBe("OWN");
    expect(chainCheck({ depth: 2, chain: [7, 8] }, 7)).toBe("OWN"); // anywhere in the chain
    expect(chainCheck({ depth: 2, chain: [5, 6] }, 7)).toBe("OK");
    expect(chainCheck({ depth: MAX_CHAIN_DEPTH, chain: [4, 5, 6] }, 7)).toBe("DEPTH");
  });
  it("counts runs in an hourly window", () => {
    const now = new Date("2026-11-22T10:00:00Z");
    expect(hourWindow(null, 0, now, 500)).toEqual({ allowed: true, reset: true });
    expect(hourWindow(new Date("2026-11-22T09:30:00Z"), 499, now, 500)).toEqual({ allowed: true, reset: false });
    expect(hourWindow(new Date("2026-11-22T09:30:00Z"), 500, now, 500)).toEqual({ allowed: false, reset: false });
    expect(hourWindow(new Date("2026-11-22T08:59:00Z"), 500, now, 500)).toEqual({ allowed: true, reset: true });
  });
});

describe("the schedule (India time)", () => {
  it("is due once a day after the time; weekly only on its day", () => {
    const clock = indiaClock(new Date("2026-11-23T04:00:00Z")); // Monday 09:30 India
    expect(clock).toEqual({ day: "2026-11-23", weekday: 1, time: "09:30" });
    expect(scheduleDue({ type: "SCHEDULED", frequency: "DAILY", time: "09:00" }, clock, null)).toBe(true);
    expect(scheduleDue({ type: "SCHEDULED", frequency: "DAILY", time: "09:00" }, clock, "2026-11-23")).toBe(false);
    expect(scheduleDue({ type: "SCHEDULED", frequency: "DAILY", time: "10:00" }, clock, null)).toBe(false);
    expect(scheduleDue({ type: "SCHEDULED", frequency: "WEEKLY", weekday: 2, time: "09:00" }, clock, null)).toBe(false);
    expect(scheduleDue({ type: "SCHEDULED", frequency: "WEEKLY", weekday: 1, time: "09:00" }, clock, null)).toBe(true);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"title":"From the ERP"}';
  it("accepts an HMAC-SHA256 signature of the exact body, or the secret as a bearer token", () => {
    expect(verifyWebhook(body, secret, { signature: signBody(body, secret), authorization: null })).toBe("SIGNATURE");
    expect(verifyWebhook(body, secret, { signature: signBody(body, secret).toUpperCase(), authorization: null })).toBe("SIGNATURE");
    expect(verifyWebhook(body, secret, { signature: null, authorization: `Bearer ${secret}` })).toBe("TOKEN");
  });
  it("refuses a changed body, another secret, or nothing", () => {
    expect(verifyWebhook(`${body} `, secret, { signature: signBody(body, secret), authorization: null })).toBeNull();
    expect(verifyWebhook(body, secret, { signature: signBody(body, "other"), authorization: null })).toBeNull();
    expect(verifyWebhook(body, secret, { signature: null, authorization: "Bearer whsec_tes" })).toBeNull();
    expect(verifyWebhook(body, secret, { signature: null, authorization: null })).toBeNull();
    expect(verifyWebhook(body, "", { signature: signBody(body, ""), authorization: null })).toBeNull();
  });
});

describe("words", () => {
  it("describes triggers for the list and the run log", () => {
    const names = { sections: new Map([[11, "Done"]]), people: new Map([[51, "Asha"]]), fields: new Map(ctx.fields.map((field) => [field.id, field])), projects: new Map(), forms: new Map([[7, "IT request"]]) };
    expect(describeTrigger({ type: "MOVED_TO_SECTION", sectionId: 11 }, names)).toBe("Task is moved to “Done”");
    expect(describeTrigger({ type: "FIELD_CHANGED", field: "f1", value: 101 }, names)).toBe("Stage is changed to New");
    expect(describeTrigger({ type: "ASSIGNEE_CHANGED", userId: 51 }, names)).toBe("Task is assigned to Asha");
    expect(describeTrigger({ type: "SCHEDULED", frequency: "WEEKLY", weekday: 5, time: "17:00" }, names)).toMatch(/^Every Friday at 17:00/);
  });
});
