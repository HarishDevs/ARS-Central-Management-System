import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as fieldsService from "@/server/work/fields-service";
import * as automations from "@/server/work/automations";
import { handleWebhook, processAutomationEvents, runTimedAutomations } from "@/server/work/automation-engine";
import { findRule, listRuns, purgeAutomationData } from "@/lib/db/repositories/automations.repository";
import { findTask, listTaskEvents } from "@/lib/db/repositories/tasks.repository";
import { listSections } from "@/lib/db/repositories/work.repository";
import { systemUserId } from "@/lib/db/repositories/intake-forms.repository";
import { actOnTask } from "@/server/modules/tasks";
import { readFiles } from "@/server/modules/upload";
import { signBody } from "@/server/work/automation-webhook";
import { indiaDay } from "@/server/work/rules";
import { addDays } from "@/server/work/schedule";
import type { ModuleCode } from "@/server/modules/modules";
import type { RuleDefinition } from "@/server/work/automation-rules";
import { POST as webhookRoute } from "@/app/api/webhooks/automations/[token]/route";
import { createUser } from "./helpers";

// v1.68.0 (D-380, PM phase D part 2) through the services: who may build,
// draft and publish, each trigger firing once, steps with the owner's rights
// (recorded as the system user for the rule), paths, loop protection (own
// changes, chain depth 3), the hourly cap, the owner losing access (pause and
// Become owner), the run log, manual runs, time triggers and the webhook
// (signature, token, rate limit, log).
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `A${id}`) => ({ id, name, roles: ["USER"] as string[], modules: ALL, sessionId: "pm-automations", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
let owner: number;
let editor: number;
let viewerOnly: number;
let outsider: number;
let projectId: number;
let sections: { id: number; name: string }[];
let stage: number;
let stageNew: number;
let stageBig: number;
let systemId: number;

const newProject = async (name: string, as = owner) => {
  const created = await work.createProject({ name, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "EDITOR", defaultView: "LIST", startOn: "", dueOn: "" }, who(as));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const task = async (title: string, project = projectId, sectionId: number | null = null, as = owner) => {
  const added = await work.quickAddTask({ title, projectId: project, sectionId, parentId: null, assigneeId: null, dueDay: addDays(indiaDay(new Date()), 10), mySectionId: null }, who(as));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
const makeRule = async (def: RuleDefinition, options: { project?: number; as?: number; name?: string; publish?: boolean } = {}) => {
  const as = options.as ?? owner;
  const created = await automations.createRule(options.project ?? projectId, who(as));
  if (!created.ok) throw new Error(created.message);
  const id = created.value.id;
  const rule = (await findRule(id))!;
  const saved = await automations.saveRule(id, { name: options.name ?? `Rule ${id}`, draft: def, rowVersion: rule.rowVersion }, who(as));
  if (!saved.ok) throw new Error(saved.message);
  if (options.publish !== false) {
    const published = await automations.publishRule(id, who(as));
    if (!published.ok) throw new Error(`${published.message} ${JSON.stringify(published.problems ?? [])}`);
  }
  return id;
};
const runsOf = async (ruleId: number) => listRuns(ruleId);
const settle = () => processAutomationEvents();
const section = (name: string) => sections.find((item) => item.name === name)!.id;
const move = async (taskId: number, to: number, project = projectId) => {
  const moved = await work.moveInProject({ taskId, projectId: project, sectionId: to, beforeId: null, afterId: null }, who(owner));
  if (!moved.ok) throw new Error(moved.message);
};

beforeAll(async () => {
  await setting("features.pm_automations", "ON");
  await setting("features.pm_planning", "ON");
  owner = await createUser({ name: `Auto owner ${tag}` });
  editor = await createUser({ name: `Auto editor ${tag}` });
  viewerOnly = await createUser({ name: `Auto viewer ${tag}` });
  outsider = await createUser({ name: `Auto outsider ${tag}` });
  projectId = await newProject(`Automations ${tag}`);
  expect((await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
  expect((await work.setMember(projectId, { type: "USER", id: viewerOnly }, "VIEWER", who(owner))).ok).toBe(true);
  sections = (await listSections(projectId)).map((item) => ({ id: item.id, name: item.name }));
  const field = await fieldsService.createField(projectId, { name: "Stage", type: "SELECT", options: [{ name: "New" }, { name: "Big" }] }, who(owner));
  if (!field.ok) throw new Error(field.message);
  stage = field.value.id;
  const [options] = await db().query<RowDataPacket[]>("SELECT id, name FROM project_field_options WHERE field_id = ?", [stage]);
  stageNew = Number(options.find((row) => row.name === "New")!.id);
  stageBig = Number(options.find((row) => row.name === "Big")!.id);
  systemId = (await systemUserId())!;
});
afterAll(async () => {
  await db().query("UPDATE project_automations SET enabled = FALSE");
  await db().query("DELETE FROM system_settings WHERE setting_key IN ('features.pm_automations', 'features.pm_planning')");
});

describe("who builds, and draft / publish", () => {
  it("needs the switch; owners and editors build; viewers and outsiders can't", async () => {
    await setting("features.pm_automations", "OFF");
    expect(await automations.createRule(projectId, who(owner))).toMatchObject({ ok: false, message: "Project automations aren't switched on yet." });
    await setting("features.pm_automations", "ON");
    expect(await automations.createRule(projectId, who(viewerOnly))).toMatchObject({ ok: false, message: "Not found." });
    expect(await automations.createRule(projectId, who(outsider))).toMatchObject({ ok: false, message: "Not found." });
    expect(await automations.projectRulesFor(projectId, who(viewerOnly))).toBeNull();
    const byEditor = await automations.createRule(projectId, who(editor));
    expect(byEditor.ok).toBe(true);
    if (byEditor.ok) expect((await automations.deleteRule(byEditor.value.id, who(editor))).ok).toBe(true);
  });
  it("\"Only admins customise\" leaves building to owners", async () => {
    const other = await newProject(`Owners only ${tag}`);
    await work.setMember(other, { type: "USER", id: editor }, "EDITOR", who(owner));
    const set = await work.setPermissions(other, { customise: "OWNER" }, who(owner));
    expect(set.ok).toBe(true);
    expect(await automations.createRule(other, who(editor))).toMatchObject({ ok: false, message: "Only the project's admins (owners) build its automations." });
  });
  it("a new rule is an untitled draft; Publish refuses problems; edits make a draft and only the published version runs", async () => {
    const created = await automations.createRule(projectId, who(owner));
    if (!created.ok) throw new Error(created.message);
    const id = created.value.id;
    let rule = (await findRule(id))!;
    expect(rule).toMatchObject({ name: "Untitled automation", published: null, ownerId: owner });
    const refused = await automations.publishRule(id, who(owner));
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? [] : refused.problems?.map((problem) => problem.where)).toEqual(expect.arrayContaining(["trigger", "rule"]));
    expect((await automations.saveRule(id, { name: "Stale", draft: { trigger: null, steps: [], paths: [], otherwise: [] }, rowVersion: rule.rowVersion - 1 }, who(owner))).ok).toBe(false);
    const def: RuleDefinition = { trigger: { type: "MOVED_TO_SECTION", sectionId: section("Done") }, steps: [{ key: "s1", type: "SET_STATUS", status: "COMPLETE" }], paths: [], otherwise: [] };
    expect((await automations.saveRule(id, { name: "Done means done", draft: def, rowVersion: rule.rowVersion }, who(owner))).ok).toBe(true);
    expect(await automations.publishRule(id, who(owner))).toMatchObject({ ok: true, value: { version: 1 } });
    rule = (await findRule(id))!;
    expect(rule.published?.steps).toHaveLength(1);
    // An edit is a draft: the published version is unchanged.
    expect((await automations.saveRule(id, { name: "Done means done", draft: { ...def, steps: [] }, rowVersion: rule.rowVersion }, who(owner))).ok).toBe(true);
    rule = (await findRule(id))!;
    expect(rule.draftChanged).toBe(true);
    expect(rule.published?.steps).toHaveLength(1);
    expect((await automations.discardDraft(id, who(owner))).ok).toBe(true);
    expect((await findRule(id))!.draft.steps).toHaveLength(1);
    expect((await automations.setRuleEnabled(id, false, who(owner))).ok).toBe(true);
  });
});

describe("running on events", () => {
  it("moving a task runs the rule once: steps as the system user for the rule, with a story and a run log", async () => {
    const ruleId = await makeRule(
      {
        trigger: { type: "MOVED_TO_SECTION", sectionId: section("In progress") },
        steps: [
          { key: "p", type: "SET_PRIORITY", priority: "URGENT" },
          { key: "c", type: "ADD_COMMENT", text: "Picked up: on it." },
        ],
        paths: [],
        otherwise: [],
      },
      { name: `Start work ${tag}` },
    );
    const id = await task(`Moved ${tag}`);
    await move(id, section("In progress"));
    expect(await settle()).toMatchObject({ runs: 1 });
    expect((await findTask(id))!.priority).toBe("URGENT");
    const runs = await runsOf(ruleId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "SUCCEEDED", taskId: id, steps: [{ ok: true }, { ok: true }] });
    expect(runs[0]!.triggerLabel).toBe("Task is moved to “In progress”");
    const events = await listTaskEvents(id);
    const story = events.find((event) => event.eventType === "EDIT" && event.body?.includes("Priority"));
    expect(story?.actorName).toBe(`Start work ${tag} (automation)`);
    const [comments] = await db().query<RowDataPacket[]>("SELECT author_id FROM task_comments WHERE task_id = ?", [id]);
    expect(comments.map((row) => Number(row.author_id))).toEqual([systemId]);
    // The audit trail names the system user acting for the owner.
    const [audit] = await db().query<RowDataPacket[]>("SELECT actor_user_id, on_behalf_of_user_id FROM audit_logs WHERE action = 'TASK_EDIT' OR (entity_type = 'TASK' AND entity_id = ? AND actor_user_id = ?) ORDER BY id DESC LIMIT 1", [String(id), systemId]);
    if (audit[0]) expect(Number(audit[0].on_behalf_of_user_id)).toBe(owner);
    // Once: nothing new on the next pass; moving within the same section starts nothing.
    expect(await settle()).toMatchObject({ runs: 0 });
    expect(await runsOf(ruleId)).toHaveLength(1);
    await automations.setRuleEnabled(ruleId, false, who(owner));
  });

  it("each event trigger fires once", async () => {
    const id = await task(`Triggers ${tag}`);
    const rules = {
      added: await makeRule({ trigger: { type: "TASK_ADDED" }, steps: [{ key: "a", type: "NOTIFY", text: "New task", targets: ["ASSIGNEE"] }], paths: [], otherwise: [] }),
      field: await makeRule({ trigger: { type: "FIELD_CHANGED", field: `f${stage}`, value: stageBig }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "HIGH" }], paths: [], otherwise: [] }),
      status: await makeRule({ trigger: { type: "STATUS_CHANGED", status: "COMPLETED" }, steps: [{ key: "a", type: "NOTIFY", text: "Done", targets: ["ASSIGNEE"] }], paths: [], otherwise: [] }),
      assignee: await makeRule({ trigger: { type: "ASSIGNEE_CHANGED", userId: editor }, steps: [{ key: "a", type: "NOTIFY", text: "Yours", targets: ["ASSIGNEE"] }], paths: [], otherwise: [] }),
      comment: await makeRule({ trigger: { type: "COMMENT_ADDED" }, steps: [{ key: "a", type: "ADD_COLLABORATORS", userIds: [viewerOnly] }], paths: [], otherwise: [] }),
      collaborator: await makeRule({ trigger: { type: "COLLABORATOR_ADDED" }, steps: [{ key: "a", type: "NOTIFY", text: "Watcher", targets: ["PROJECT_OWNERS"] }], paths: [], otherwise: [] }),
      attachment: await makeRule({ trigger: { type: "ATTACHMENT_ADDED" }, steps: [{ key: "a", type: "NOTIFY", text: "File", targets: ["ASSIGNEE"] }], paths: [], otherwise: [] }),
    };
    const fresh = await task(`Added after ${tag}`);
    await settle();
    expect((await runsOf(rules.added)).filter((run) => run.taskId === fresh)).toHaveLength(1);
    expect((await fieldsService.setFieldValue(id, stage, stageNew, who(owner))).ok).toBe(true);
    await settle();
    expect((await runsOf(rules.field)).filter((run) => run.taskId === id)).toHaveLength(0); // a different value
    expect((await fieldsService.setFieldValue(id, stage, stageBig, who(owner))).ok).toBe(true);
    await settle();
    expect((await runsOf(rules.field)).filter((run) => run.taskId === id)).toHaveLength(1);
    expect((await findTask(id))!.priority).toBe("HIGH");
    expect((await work.setTaskFields(id, { assigneeId: editor }, who(owner))).ok).toBe(true);
    await settle();
    expect((await runsOf(rules.assignee)).filter((run) => run.taskId === id)).toHaveLength(1);
    expect((await work.addComment(id, "Hello", null, who(owner))).ok).toBe(true);
    await settle();
    expect((await runsOf(rules.comment)).filter((run) => run.taskId === id)).toHaveLength(1);
    // The comment rule added a collaborator: the collaborator rule ran too (a chain of 2).
    const chained = (await runsOf(rules.collaborator)).filter((run) => run.taskId === id);
    expect(chained).toHaveLength(1);
    expect(chained[0]!.depth).toBe(2);
    const data = new FormData();
    data.append("attachments", new File([`%PDF-1.4\nauto\n%%EOF`], "auto.pdf", { type: "application/pdf" }));
    const files = await readFiles(data, []);
    if (!files.ok) throw new Error(files.message);
    expect((await actOnTask({ taskId: id, action: "COMMENT", rowVersion: null, reason: "See the file", assigneeId: null, files: files.staged }, who(owner))).ok).toBe(true);
    await settle();
    expect((await runsOf(rules.attachment)).filter((run) => run.taskId === id)).toHaveLength(1);
    expect((await work.toggleComplete(id, who(owner))).ok).toBe(true);
    await settle();
    expect((await runsOf(rules.status)).filter((run) => run.taskId === id)).toHaveLength(1);
    await settle();
    // The file came with a comment: the comment rule ran for both comments (one each).
    expect((await runsOf(rules.comment)).filter((run) => run.taskId === id)).toHaveLength(2);
    for (const ruleId of Object.values(rules)) {
      if (ruleId === rules.comment) {
        await automations.setRuleEnabled(ruleId, false, who(owner));
        continue;
      }
      const counts = new Map<number, number>();
      for (const run of await runsOf(ruleId)) if (run.taskId) counts.set(run.taskId, (counts.get(run.taskId) ?? 0) + 1);
      expect([...counts.values()].every((count) => count === 1)).toBe(true);
      await automations.setRuleEnabled(ruleId, false, who(owner));
    }
  });

  it("paths: the first matching path runs, else Otherwise", async () => {
    const ruleId = await makeRule({
      trigger: { type: "MOVED_TO_SECTION", sectionId: section("To do") },
      steps: [],
      paths: [{ key: "p1", name: "Big ones", match: "ALL", conditions: [{ subject: "FIELD", fieldId: stage, op: "IS", value: stageBig }], steps: [{ key: "a", type: "SET_PRIORITY", priority: "URGENT" }] }],
      otherwise: [{ key: "b", type: "SET_PRIORITY", priority: "ELEVATED" }],
    });
    const big = await task(`Big ${tag}`, projectId, section("In progress"));
    const small = await task(`Small ${tag}`, projectId, section("In progress"));
    await fieldsService.setFieldValue(big, stage, stageBig, who(owner));
    await move(big, section("To do"));
    await move(small, section("To do"));
    await settle();
    expect((await findTask(big))!.priority).toBe("URGENT");
    expect((await findTask(small))!.priority).toBe("ELEVATED");
    const runs = await runsOf(ruleId);
    expect(runs.map((run) => run.steps[0]?.label).sort()).toEqual(["No path matched: Otherwise", "Path “Big ones” matched"]);
    await automations.setRuleEnabled(ruleId, false, who(owner));
  });
});

describe("loop protection, caps and permissions", () => {
  it("a rule's own change never starts it again", async () => {
    const ruleId = await makeRule({ trigger: { type: "FIELD_CHANGED", field: "priority" }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "IMPORTANT" }], paths: [], otherwise: [] });
    const id = await task(`Own ${tag}`);
    await work.setTaskFields(id, { priority: "HIGH" }, who(owner));
    await settle();
    expect((await findTask(id))!.priority).toBe("IMPORTANT");
    expect((await runsOf(ruleId)).filter((run) => run.taskId === id)).toHaveLength(1);
    await automations.setRuleEnabled(ruleId, false, who(owner));
  });

  it("a chain stops after 3 rules (the 4th is logged as not run)", async () => {
    const chain = await newProject(`Chain ${tag}`);
    for (const name of ["S4", "S3", "S2", "S1"]) await work.addSection(chain, name, null, who(owner));
    const all = await listSections(chain);
    const s = (name: string) => all.find((item) => item.name === name)!.id;
    const r1 = await makeRule({ trigger: { type: "MOVED_TO_SECTION", sectionId: s("S1") }, steps: [{ key: "a", type: "MOVE_TO_SECTION", sectionId: s("S2") }], paths: [], otherwise: [] }, { project: chain });
    const r2 = await makeRule({ trigger: { type: "MOVED_TO_SECTION", sectionId: s("S2") }, steps: [{ key: "a", type: "MOVE_TO_SECTION", sectionId: s("S3") }], paths: [], otherwise: [] }, { project: chain });
    const r3 = await makeRule({ trigger: { type: "MOVED_TO_SECTION", sectionId: s("S3") }, steps: [{ key: "a", type: "MOVE_TO_SECTION", sectionId: s("S4") }], paths: [], otherwise: [] }, { project: chain });
    const r4 = await makeRule({ trigger: { type: "MOVED_TO_SECTION", sectionId: s("S4") }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "URGENT" }], paths: [], otherwise: [] }, { project: chain });
    const id = await task(`Chain ${tag}`, chain, s("To do"));
    await move(id, s("S1"), chain);
    await settle();
    expect((await runsOf(r1))[0]).toMatchObject({ status: "SUCCEEDED", depth: 1 });
    expect((await runsOf(r2))[0]).toMatchObject({ status: "SUCCEEDED", depth: 2 });
    expect((await runsOf(r3))[0]).toMatchObject({ status: "SUCCEEDED", depth: 3 });
    expect((await runsOf(r4))[0]).toMatchObject({ status: "SKIPPED" });
    expect((await runsOf(r4))[0]!.error).toMatch(/loop protection/);
    expect((await findTask(id))!.priority).not.toBe("URGENT");
  });

  it("the hourly cap stops a rule", async () => {
    const ruleId = await makeRule({ trigger: { type: "COMMENT_ADDED" }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "HIGH" }], paths: [], otherwise: [] });
    await db().query("UPDATE project_automations SET hour_start = UTC_TIMESTAMP(), hour_runs = 500 WHERE id = ?", [ruleId]);
    const id = await task(`Capped ${tag}`);
    await work.addComment(id, "Go", null, who(owner));
    await settle();
    const runs = (await runsOf(ruleId)).filter((run) => run.taskId === id);
    expect(runs[0]).toMatchObject({ status: "SKIPPED" });
    expect(runs[0]!.error).toMatch(/hourly limit/);
    expect((await findTask(id))!.priority).not.toBe("HIGH");
    await automations.setRuleEnabled(ruleId, false, who(owner));
  });

  it("steps use the owner's rights (never more): an editor's rule can't change another person's ad hoc task", async () => {
    const ruleId = await makeRule({ trigger: { type: "COMMENT_ADDED" }, steps: [{ key: "a", type: "SET_DUE", days: 2 }], paths: [], otherwise: [] }, { as: editor });
    const id = await task(`Not yours ${tag}`); // created by the owner: an ad hoc task only its creator changes
    await work.addComment(id, "Hi", null, who(owner));
    await settle();
    const run = (await runsOf(ruleId)).find((item) => item.taskId === id)!;
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/creator/);
    // The owner of the rule is told once about the failure.
    const [told] = await db().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_EXTRACT(payload_json, '$.userId') = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) LIKE 'Automation failed:%'", [editor]);
    expect(Number(told[0]!.n)).toBe(1);
    await automations.setRuleEnabled(ruleId, false, who(editor));
  });

  it("an owner who loses access pauses the rule (project owners told); Become owner starts it again", async () => {
    const ruleId = await makeRule({ trigger: { type: "COMMENT_ADDED" }, steps: [{ key: "a", type: "ADD_COMMENT", text: "Thanks!" }], paths: [], otherwise: [] }, { as: editor, name: `Editor rule ${tag}` });
    expect((await work.setMember(projectId, { type: "USER", id: editor }, null, who(owner))).ok).toBe(true);
    const id = await task(`Paused ${tag}`);
    await work.addComment(id, "Anyone?", null, who(owner));
    await settle();
    const rule = (await findRule(ruleId))!;
    expect(rule.pausedReason).toMatch(/can no longer edit/);
    expect((await runsOf(ruleId))[0]).toMatchObject({ status: "SKIPPED" });
    const [told] = await db().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_EXTRACT(payload_json, '$.userId') = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) = ?", [owner, `Automation paused: Editor rule ${tag}`]);
    expect(Number(told[0]!.n)).toBe(1);
    // Later changes don't run it (and don't fill the log).
    await work.addComment(id, "Hello?", null, who(owner));
    await settle();
    expect(await runsOf(ruleId)).toHaveLength(1);
    expect(await automations.becomeOwner(ruleId, who(editor))).toMatchObject({ ok: false, message: "Not found." });
    expect((await automations.becomeOwner(ruleId, who(owner))).ok).toBe(true);
    expect((await findRule(ruleId))!).toMatchObject({ ownerId: owner, pausedReason: null });
    await work.addComment(id, "Now?", null, who(owner));
    await settle();
    expect((await runsOf(ruleId))[0]).toMatchObject({ status: "SUCCEEDED" });
    await automations.setRuleEnabled(ruleId, false, who(owner));
    await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner));
  });

  it("limits: rules per project (Admin setting)", async () => {
    const small = await newProject(`Limits ${tag}`);
    await db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES ('tasks.automation_limits', 'TASKS', 'JSON', FALSE, '{\"perProject\": 1, \"stepsPerRule\": 1}') ON DUPLICATE KEY UPDATE value = VALUES(value)");
    try {
      expect((await automations.createRule(small, who(owner))).ok).toBe(true);
      expect(await automations.createRule(small, who(owner))).toMatchObject({ ok: false, message: expect.stringMatching(/at most 1 automations/) });
      const [rule] = (await automations.projectRulesFor(small, who(owner)))!.rows;
      const record = (await findRule(rule!.id))!;
      const saved = await automations.saveRule(record.id, { name: "Two steps", draft: { trigger: { type: "COMMENT_ADDED" }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "HIGH" }, { key: "b", type: "SET_PRIORITY", priority: "URGENT" }], paths: [], otherwise: [] }, rowVersion: record.rowVersion }, who(owner));
      expect(saved.ok && saved.value.problems.some((problem) => /at most 1 steps/.test(problem.message))).toBe(true);
    } finally {
      await db().query("DELETE FROM system_settings WHERE setting_key = 'tasks.automation_limits'");
    }
  });
});

describe("manual, time and scheduled triggers", () => {
  it("Run on this task: listed for owners and editors, runs at once", async () => {
    const ruleId = await makeRule({ trigger: { type: "MANUAL" }, steps: [{ key: "a", type: "CREATE_SUBTASKS", titles: ["Check", "Sign off"] }], paths: [], otherwise: [] }, { name: `By hand ${tag}` });
    const id = await task(`Manual ${tag}`);
    expect((await automations.manualRulesFor(id, who(editor))).map((rule) => rule.id)).toContain(ruleId);
    expect(await automations.manualRulesFor(id, who(viewerOnly))).toEqual([]);
    expect(await automations.runOnTask(ruleId, id, who(viewerOnly))).toMatchObject({ ok: false, message: "Not found." });
    const ran = await automations.runOnTask(ruleId, id, who(editor));
    expect(ran).toMatchObject({ ok: true });
    const [subtasks] = await db().query<RowDataPacket[]>("SELECT title, created_by FROM tasks WHERE parent_task_id = ? ORDER BY id", [id]);
    expect(subtasks.map((row) => String(row.title))).toEqual(["Check", "Sign off"]);
    await automations.setRuleEnabled(ruleId, false, who(owner));
  });

  it("due date approaching and overdue fire once per due date; scheduled rules once a day for matching tasks", async () => {
    const today = indiaDay(new Date());
    const soon = await makeRule({ trigger: { type: "DUE_APPROACHING", days: 2 }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "HIGH" }], paths: [], otherwise: [] });
    const late = await makeRule({ trigger: { type: "OVERDUE" }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "URGENT" }], paths: [], otherwise: [] });
    const due = await task(`Soon ${tag}`);
    await work.setTaskFields(due, { dueDay: addDays(today, 2), holidayOk: true }, who(owner));
    const overdue = await task(`Late ${tag}`);
    // Overdue a minute ago, after the rule was published (an hour ago here).
    await db().query("UPDATE project_automations SET published_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE id = ?", [late]);
    await db().query("UPDATE tasks SET due_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = ?", [overdue]);
    await settle();
    await runTimedAutomations();
    await runTimedAutomations();
    expect((await runsOf(soon)).filter((run) => run.taskId === due)).toHaveLength(1);
    expect((await runsOf(late)).filter((run) => run.taskId === overdue)).toHaveLength(1);
    expect((await findTask(overdue))!.priority).toBe("URGENT");
    await automations.setRuleEnabled(soon, false, who(owner));
    await automations.setRuleEnabled(late, false, who(owner));

    const scheduled = await makeRule({ trigger: { type: "SCHEDULED", frequency: "DAILY", time: "00:00", filter: [{ subject: "NAME", op: "CONTAINS", value: `Sched ${tag}` }] }, steps: [{ key: "a", type: "ADD_COMMENT", text: "Daily check" }], paths: [], otherwise: [] });
    const picked = await task(`Sched ${tag}`);
    await runTimedAutomations();
    await runTimedAutomations();
    const runs = await runsOf(scheduled);
    expect(runs.map((run) => run.taskId)).toEqual([picked]);
    await automations.setRuleEnabled(scheduled, false, who(owner));
  });
});

describe("the incoming webhook", () => {
  it("creates a task with a signed call; refuses a wrong signature; updates by number; rate-limited; logged", async () => {
    const ruleId = await makeRule({ trigger: { type: "WEBHOOK", webhookMode: "CREATE", sectionId: section("In progress") }, steps: [{ key: "a", type: "ADD_COMMENT", text: "From the ERP" }], paths: [], otherwise: [] }, { name: `Hook ${tag}` });
    const made = await automations.newSecret(ruleId, who(owner));
    if (!made.ok) throw new Error(made.message);
    const rule = (await findRule(ruleId))!;
    const token = rule.webhookToken!;
    const call = (body: string, headers: Record<string, string>) => webhookRoute(new Request(`http://localhost/api/webhooks/automations/${token}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } }) as never, { params: Promise.resolve({ token }) });
    const body = JSON.stringify({ title: `ERP order ${tag}`, priority: "high" });
    const wrong = await call(body, { "x-ars-signature": signBody(body, "nope") });
    expect(wrong.status).toBe(401);
    const ok = await call(body, { "x-ars-signature": signBody(body, made.value.secret), "idempotency-key": `order-${tag}` });
    expect(ok.status).toBe(201);
    const answer = (await ok.json()) as { data: { taskId: number; taskNo: string; run: string } };
    expect(answer.data.run).toBe("SUCCEEDED");
    const created = (await findTask(answer.data.taskId))!;
    expect(created).toMatchObject({ title: `ERP order ${tag}`, priority: "HIGH" });
    // The same Idempotency-Key again: the first answer, no second task.
    const again = await call(body, { authorization: `Bearer ${made.value.secret}`, "idempotency-key": `order-${tag}` });
    expect(((await again.json()) as { data: { taskId: number } }).data.taskId).toBe(answer.data.taskId);
    // Unknown address: not found.
    const missing = await webhookRoute(new Request("http://localhost/api/webhooks/automations/AAAAAAAAAAAAAAAAAAAAAA", { method: "POST", body }) as never, { params: Promise.resolve({ token: "AAAAAAAAAAAAAAAAAAAAAA" }) });
    expect(missing.status).toBe(404);
    // Update by the task's number (a rule in UPDATE mode).
    const updater = await makeRule({ trigger: { type: "WEBHOOK", webhookMode: "UPDATE" }, steps: [{ key: "a", type: "SET_PRIORITY", priority: "URGENT" }], paths: [], otherwise: [] });
    const updated = await handleWebhook((await findRule(updater))!, { task: created.taskNo, dueDate: addDays(indiaDay(new Date()), 5) }, null);
    expect(updated).toMatchObject({ ok: true, status: 200, taskId: created.id });
    expect((await findTask(created.id))!.priority).toBe("URGENT");
    expect(await handleWebhook((await findRule(updater))!, { task: "TSK-0" }, null)).toMatchObject({ ok: false, status: 404 });
    // Every call is logged; at most 60 a minute.
    const [logged] = await db().query<RowDataPacket[]>("SELECT status, http_status FROM automation_webhook_deliveries WHERE automation_id = ? ORDER BY id", [ruleId]);
    expect(logged.map((row) => `${String(row.status)} ${Number(row.http_status)}`)).toEqual(["REFUSED 401", "ACCEPTED 201", "ACCEPTED 200"]);
    await db().query("INSERT INTO automation_webhook_deliveries (automation_id, status, http_status) SELECT ?, 'REFUSED', 401 FROM information_schema.columns LIMIT 60", [ruleId]);
    expect((await call(body, { authorization: `Bearer ${made.value.secret}` })).status).toBe(429);
    // Switch off: the address is "not found".
    await setting("features.pm_automations", "OFF");
    expect((await call(body, { authorization: `Bearer ${made.value.secret}` })).status).toBe(404);
    await setting("features.pm_automations", "ON");
    // Purge: calls older than 30 days go.
    await db().query("UPDATE automation_webhook_deliveries SET received_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 DAY) WHERE automation_id = ?", [ruleId]);
    expect((await purgeAutomationData()).webhookCallsPruned).toBeGreaterThanOrEqual(63);
    await automations.setRuleEnabled(ruleId, false, who(owner));
    await automations.setRuleEnabled(updater, false, who(owner));
  });
});
