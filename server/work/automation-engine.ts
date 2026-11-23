import "server-only";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { runAsAutomation } from "@/lib/automation/context";
import * as autoRepo from "@/lib/db/repositories/automations.repository";
import type { RuleRecord, StepOutcome } from "@/lib/db/repositories/automations.repository";
import { appendTaskEvent, findTask, personFacts, type TaskRecord } from "@/lib/db/repositories/tasks.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as fieldsRepo from "@/lib/db/repositories/fields.repository";
import { systemUserId } from "@/lib/db/repositories/intake-forms.repository";
import { findUserById } from "@/lib/db/repositories/users.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { afterResponse } from "@/lib/http/after-response";
import { logError } from "@/lib/logging/logger";
import { deliverOutbox } from "@/server/approvals/service";
import { automationMessages, taskMessages } from "@/server/modules/messages";
import type { TaskActor } from "@/server/modules/tasks";
import { OPEN_STATUSES } from "@/server/modules/task-rules";
import { TASK_PRIORITIES } from "@/server/modules/settings";
import { featureMode } from "@/server/settings/features";
import type { NotifyInput } from "@/server/notifications/notify";
import { projectAbilities } from "@/server/work/access";
import {
  allSteps,
  chainCheck,
  choosePath,
  conditionsMatch,
  describeStep,
  describeTrigger,
  eventMatches,
  GLOBAL_RUNS_PER_HOUR,
  hourWindow,
  indiaClock,
  RUNS_PER_HOUR,
  SCHEDULED_TASK_CAP,
  scheduleDue,
  type AutomationEvent,
  type FieldFact,
  type Names,
  type Step,
  type TaskFacts,
  type TriggerType,
} from "@/server/work/automation-rules";
import { addDays, addWorkDays } from "@/server/work/schedule";
import { indiaDay } from "@/server/work/rules";
import { rightsOn, workViewer } from "@/server/work/task-access";
import { workCalendar } from "@/server/work/schedule-service";
import * as work from "@/server/work/service";
import { cellsFor, setFieldValue } from "@/server/work/fields-service";

// v1.68.0 (D-380, PM phase D part 2, spec AUTOMATION_WORKFLOWS WF-AUTO-02..06):
// the automation engine. Task changes in projects with live rules land in the
// automation_events outbox (written with the change); this file claims them
// after the commit, finds the published rules whose trigger matches, and runs
// each rule's steps through the ordinary task services AS THE RULE'S OWNER
// (their rights, never more), recorded as the system user "ARS-CMS
// Automation" on behalf of the rule (lib/automation/context.ts). Time
// triggers (due date approaching, overdue, scheduled) run from the job runner.
// Loop protection: a rule's own changes never start it again; at most 3 rules
// in a chain; 500 runs an hour per rule; 5,000 an hour in all; one run per
// rule and event (unique run key).
const db = () => getDbPool();
const EVENT_TRIGGERS: TriggerType[] = ["TASK_ADDED", "MOVED_TO_SECTION", "FIELD_CHANGED", "STATUS_CHANGED", "ASSIGNEE_CHANGED", "ATTACHMENT_ADDED", "COMMENT_ADDED", "COLLABORATOR_ADDED", "FORM_SUBMITTED"];
export const OWNER_LOST = "its owner can no longer edit the project (or has left).";

export async function automationsLive(): Promise<boolean> {
  return (await featureMode("pm_automations").catch(() => "OFF" as const)) !== "OFF";
}

// ---- facts ----------------------------------------------------------------------------------
export async function factsFor(task: TaskRecord, projectId: number, ownerId: number): Promise<TaskFacts> {
  const links = await repo.listTaskProjects(task.id);
  const defs = await fieldsRepo.listFieldDefs(projectId);
  const rows = (await fieldsRepo.valueRows([task.id])).get(task.id);
  const fields = new Map<number, FieldFact>();
  for (const def of defs) {
    const stored = fieldsRepo.storedOf(def, rows?.get(def.id));
    fields.set(def.id, { type: def.type, text: stored?.text ?? null, number: stored?.number ?? null, date: stored?.date ?? null, optionId: stored?.optionId ?? null, ids: stored?.ids ?? null });
  }
  // Formula fields are worked out as the owner would see them.
  const formulas = defs.filter((def) => def.type === "FORMULA");
  if (formulas.length) {
    const owner = await findUserById(ownerId);
    if (owner) {
      const viewer = await workViewer({ id: owner.id, roles: owner.roles, modules: owner.modules });
      // v1.88.0 (D-418): cellsFor brings what the formulas read; a formula
      // that gives a date is compared as a date.
      const cells = (await cellsFor([task.id], formulas, { ...viewer, id: owner.id }))[task.id] ?? {};
      for (const def of formulas) {
        const sort = cells[def.id]?.sort;
        fields.set(def.id, { type: "FORMULA", text: null, number: typeof sort === "number" ? sort : null, date: typeof sort === "string" ? sort : null, optionId: null, ids: null });
      }
    }
  }
  return {
    sectionId: links.find((link) => link.projectId === projectId)?.sectionId ?? null,
    assigneeId: task.assigneeId,
    priority: task.priority,
    dueDay: task.dueAt ? indiaDay(task.dueAt) : null,
    status: task.status,
    title: task.title,
    fields,
  };
}

export async function namesFor(projectId: number): Promise<Names> {
  const [sections, defs] = await Promise.all([repo.listSections(projectId), fieldsRepo.listFieldDefs(projectId)]);
  const [people] = await db().query<RowDataPacket[]>("SELECT id, name FROM users WHERE is_system = FALSE");
  const [projects] = await db().query<RowDataPacket[]>("SELECT id, name FROM projects WHERE deleted_at IS NULL");
  const [forms] = await db().query<RowDataPacket[]>("SELECT id, name FROM project_forms WHERE project_id = ?", [projectId]);
  return {
    sections: new Map(sections.map((section) => [section.id, section.name])),
    people: new Map(people.map((row) => [Number(row.id), String(row.name)])),
    fields: new Map(defs.map((def) => [def.id, { id: def.id, name: def.name, type: def.type, options: def.options }])),
    projects: new Map(projects.map((row) => [Number(row.id), String(row.name)])),
    forms: new Map(forms.map((row) => [Number(row.id), String(row.name)])),
  };
}

// ---- who the rule acts as --------------------------------------------------------------------
async function ownerActorFor(rule: RuleRecord): Promise<TaskActor | null> {
  const owner = await findUserById(rule.ownerId);
  if (!owner || !owner.active || owner.isSystem) return null;
  return { id: owner.id, name: `${rule.name} (automation)`, roles: owner.roles, modules: owner.modules, sessionId: `automation:${rule.id}`, ipAddress: null };
}
// The owner must still be an owner or editor of the rule's project.
export async function ownerMayRun(rule: Pick<RuleRecord, "projectId" | "ownerId">): Promise<boolean> {
  const owner = await findUserById(rule.ownerId);
  if (!owner || !owner.active || owner.isSystem) return false;
  const viewer = await workViewer({ id: owner.id, roles: owner.roles, modules: owner.modules });
  const found = await repo.projectFor(rule.projectId, viewer);
  return Boolean(found && projectAbilities(found.role).edit);
}

async function projectOwnerIds(projectId: number): Promise<number[]> {
  const members = await repo.listProjectMembers(projectId);
  return members.filter((member) => member.type === "USER" && member.role === "OWNER").map((member) => member.id);
}
async function tell(messages: NotifyInput[]) {
  if (!messages.length) return;
  const ids = await withTransaction((connection) => insertOutbox(null, messages, connection));
  if (ids.length) await afterResponse("automation messages", () => deliverOutbox(ids));
}
async function pauseRule(rule: RuleRecord, reason: string) {
  if (!(await autoRepo.setPaused(rule.id, reason))) return;
  const project = await repo.findProject(rule.projectId);
  if (!project) return;
  const to = new Set([...(await projectOwnerIds(rule.projectId)), rule.ownerId]);
  const people = await Promise.all([...to].map((id) => personFacts(id)));
  await tell(people.filter((person) => person?.active).map((person) => automationMessages.paused({ id: project.id, name: project.name }, person!.id, rule.name, reason)));
}

// ---- running one rule on one task ------------------------------------------------------------
export interface RunResult {
  status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "NONE"; // NONE: not run (own change, paused, already ran)
  runId: number | null;
  steps: StepOutcome[];
  error: string | null;
}
const none: RunResult = { status: "NONE", runId: null, steps: [], error: null };

interface RunOptions {
  key: string;
  triggerLabel?: string;
  depth?: number; // the depth of the change that started it (0 = a person)
  chain?: number[];
}
export async function runRule(rule: RuleRecord, task: TaskRecord, options: RunOptions): Promise<RunResult> {
  const def = rule.published;
  if (!def || !def.trigger || !rule.enabled || rule.pausedReason) return none;
  const names = await namesFor(rule.projectId);
  const label = options.triggerLabel ?? describeTrigger(def.trigger, names);
  const event = { depth: options.depth ?? 0, chain: options.chain ?? [] };
  const depth = event.depth + 1;
  const skipped = async (error: string): Promise<RunResult> => {
    const runId = await autoRepo.startRun({ automationId: rule.id, version: rule.publishedVersion, key: options.key, triggerLabel: label, taskId: task.id, taskNo: task.taskNo, depth, status: "SKIPPED", error });
    if (runId) await autoRepo.recordOutcome(rule.id, "SKIPPED", error);
    return { status: "SKIPPED", runId, steps: [], error };
  };
  const chain = chainCheck(event, rule.id);
  if (chain === "OWN") return none;
  if (chain === "DEPTH") return skipped("Stopped: more than 3 automations in a row would have changed this task (loop protection).");
  // The owner's rights: if they are gone, the rule pauses and the people responsible are told.
  const project = await repo.findProject(rule.projectId);
  if (!project || project.deletedAt || project.archivedAt) return none;
  const actor = await ownerActorFor(rule);
  if (!actor || !(await ownerMayRun(rule))) {
    await pauseRule(rule, `Paused: ${OWNER_LOST}`);
    return skipped(`Paused: ${OWNER_LOST}`);
  }
  const now = new Date();
  const window = hourWindow(rule.hourStart, rule.hourRuns, now, RUNS_PER_HOUR);
  if (!window.allowed) return skipped(`Not run: this rule has run ${RUNS_PER_HOUR} times in the last hour (the hourly limit).`);
  if ((await autoRepo.runsInLastHour()) >= GLOBAL_RUNS_PER_HOUR) return skipped(`Not run: automations have run ${GLOBAL_RUNS_PER_HOUR} times in the last hour across the app (the overall limit).`);
  const systemId = await systemUserId();
  if (!systemId) return skipped("Not run: the system user is missing. Ask IT.");
  const runId = await autoRepo.startRun({ automationId: rule.id, version: rule.publishedVersion, key: options.key, triggerLabel: label, taskId: task.id, taskNo: task.taskNo, depth });
  if (!runId) return none; // this rule already ran for this event (idempotency)
  await autoRepo.countRunInWindow(rule.id, window.reset);

  const outcomes: StepOutcome[] = [];
  let error: string | null = null;
  try {
    await runAsAutomation({ ruleId: rule.id, ruleName: rule.name, ownerId: rule.ownerId, systemId, depth, chain: [...event.chain, rule.id] }, async () => {
      const runSteps = async (steps: readonly Step[]) => {
        for (const step of steps) {
          const labelled = describeStep(step, names);
          let result: { ok: boolean; message?: string | null };
          try {
            result = await executeStep(step, rule, task.id, actor, systemId);
          } catch (stepError) {
            logError(`automation ${rule.id} step ${step.type} failed`, stepError);
            result = { ok: false, message: "Something went wrong in this step." };
          }
          outcomes.push({ label: labelled, ok: result.ok, message: result.message ?? null });
          if (!result.ok) {
            error = `${labelled}: ${result.message ?? "failed"}`;
            return false;
          }
        }
        return true;
      };
      if (!(await runSteps(def.steps))) return;
      if (def.paths.length) {
        const fresh = await findTask(task.id);
        if (!fresh || fresh.deletedAt) return;
        const facts = await factsFor(fresh, rule.projectId, rule.ownerId);
        const chosen = choosePath(def, facts, indiaDay(new Date()));
        outcomes.push({ label: chosen.path ? `Path “${chosen.path.name}” matched` : def.otherwise.length ? "No path matched: Otherwise" : "No path matched", ok: true, message: null });
        await runSteps(chosen.steps);
      }
    });
  } catch (runError) {
    logError(`automation ${rule.id} run failed`, runError);
    error = "Something went wrong while the rule ran.";
  }
  const status = error ? "FAILED" : "SUCCEEDED";
  await autoRepo.finishRun(runId, status, outcomes, error);
  const { firstFailure } = await autoRepo.recordOutcome(rule.id, status, error);
  // BR-AUTO-007: the owner is told the first time a rule fails (not again until it has worked).
  if (firstFailure && error) await tell([automationMessages.failed({ id: project.id, name: project.name }, rule.ownerId, rule.name, error)]);
  return { status, runId, steps: outcomes, error };
}

// ---- the steps ---------------------------------------------------------------------------------
type StepResult = { ok: boolean; message?: string | null };
const done = (message: string | null = null): StepResult => ({ ok: true, message });
const fromWork = (result: { ok: boolean; message?: string }): StepResult => ({ ok: result.ok, message: result.message ?? null });

async function executeStep(step: Step, rule: RuleRecord, taskId: number, actor: TaskActor, systemId: number): Promise<StepResult> {
  const task = await findTask(taskId);
  if (!task || task.deletedAt) return { ok: false, message: "The task has been deleted." };
  const today = indiaDay(new Date());
  switch (step.type) {
    case "MOVE_TO_SECTION": {
      const link = (await repo.listTaskProjects(taskId)).find((item) => item.projectId === rule.projectId);
      if (!link) return { ok: false, message: "The task is no longer in this project." };
      if (link.sectionId === step.sectionId) return done("Already in that section.");
      return fromWork(await work.moveInProject({ taskId, projectId: rule.projectId, sectionId: step.sectionId ?? 0, beforeId: null, afterId: null }, actor));
    }
    case "ADD_TO_PROJECT": {
      if ((await repo.listTaskProjects(taskId)).some((item) => item.projectId === step.projectId)) return done("Already in that project.");
      return fromWork(await work.addToProject(taskId, step.projectId ?? 0, step.sectionId ?? null, actor));
    }
    case "SET_STATUS": {
      if (step.status === "COMPLETE") {
        if (task.status === "COMPLETED") return done("Already complete.");
        if (!OPEN_STATUSES.includes(task.status)) return { ok: false, message: "The task is closed." };
      } else if (task.status !== "COMPLETED") return done("Already incomplete.");
      return fromWork(await work.toggleComplete(taskId, actor));
    }
    case "SET_ASSIGNEE":
      if (task.assigneeId === step.userId) return done("Already assigned to that person.");
      return fromWork(await work.setTaskFields(taskId, { assigneeId: step.userId ?? 0 }, actor));
    case "SET_DUE": {
      const day = step.workingDays ? addWorkDays(today, step.days ?? 0, await workCalendar(db()), true) : addDays(today, step.days ?? 0);
      return fromWork(await work.setTaskFields(taskId, { dueDay: day, holidayOk: true }, actor));
    }
    case "SET_PRIORITY":
      if (!(TASK_PRIORITIES as readonly string[]).includes(step.priority ?? "")) return { ok: false, message: "Choose a priority." };
      if (task.priority === step.priority) return done("Already that priority.");
      return fromWork(await work.setTaskFields(taskId, { priority: step.priority }, actor));
    case "SET_FIELD": {
      const value = step.value === "" ? null : step.value;
      return fromWork(await setFieldValue(taskId, step.fieldId ?? 0, value, actor));
    }
    case "CREATE_TASK": {
      const dueDay = step.days === undefined ? (task.dueAt ? indiaDay(task.dueAt) : today) : step.workingDays ? addWorkDays(today, step.days, await workCalendar(db()), true) : addDays(today, step.days);
      const created = await work.quickAddTask({ title: step.title ?? "", projectId: rule.projectId, sectionId: step.sectionId ?? null, parentId: null, assigneeId: step.userId ?? task.assigneeId, dueDay, mySectionId: null, holidayOk: true, description: `Created by the automation "${rule.name}" from ${task.taskNo}.` }, actor);
      return created.ok ? done(`Created ${created.value.taskNo}.`) : fromWork(created);
    }
    case "CREATE_SUBTASKS": {
      const titles = (step.titles ?? []).map((title) => title.trim()).filter(Boolean);
      const dueDay = task.dueAt ? indiaDay(task.dueAt) : today;
      const made: string[] = [];
      for (const title of titles) {
        const created = await work.quickAddTask({ title, projectId: null, sectionId: null, parentId: taskId, assigneeId: step.userId ?? task.assigneeId, dueDay, mySectionId: null, holidayOk: true }, actor);
        if (!created.ok) return { ok: false, message: `${made.length ? `Made ${made.join(", ")}; then ` : ""}${created.message}` };
        made.push(created.value.taskNo);
      }
      return done(`Created ${made.join(", ")}.`);
    }
    case "ADD_COMMENT":
      return addSystemComment(task, step.text ?? "", rule, actor, systemId);
    case "ADD_COLLABORATORS": {
      for (const userId of step.userIds ?? []) {
        const result = await work.setFollower(taskId, userId, true, actor);
        if (!result.ok) return fromWork(result);
      }
      return done();
    }
    case "NOTIFY":
      return notifyPeople(task, step, rule);
  }
}

// "Add a comment": written by the system user on behalf of the rule, if the
// rule's owner may comment on the task. The task's people hear of it.
async function addSystemComment(task: TaskRecord, text: string, rule: RuleRecord, actor: TaskActor, systemId: number): Promise<StepResult> {
  const body = text.trim().slice(0, 4000);
  if (!body) return { ok: false, message: "The comment is empty." };
  const viewer = await workViewer(actor);
  if (!(await rightsOn(task, viewer)).comment) return { ok: false, message: "The rule's owner can't comment on this task." };
  const ids = await withTransaction(async (connection) => {
    const id = await repo.insertComment(task.id, null, systemId, body, connection);
    await appendTaskEvent(task.id, { actorId: systemId, type: "COMMENTED", body: body.slice(0, 2000), payload: { commentId: id } }, connection);
    const followers = (await repo.listFollowers(task.id, connection)).map((item) => item.id);
    const recipients = new Set<number>([task.assigneeId, task.createdBy, ...followers]);
    recipients.delete(systemId);
    const info = { id: task.id, taskNo: task.taskNo, title: task.title, dueAt: task.dueAt };
    return insertOutbox(null, [...recipients].map((person) => taskMessages.comment(info, person, actor.name)), connection);
  });
  if (ids.length) await afterResponse("automation comment messages", () => deliverOutbox(ids));
  return done();
}

// "Notify people": only active people who can see the task hear of it.
async function notifyPeople(task: TaskRecord, step: Step, rule: RuleRecord): Promise<StepResult> {
  const to = new Set<number>(step.userIds ?? []);
  for (const target of step.targets ?? []) {
    if (target === "ASSIGNEE") to.add(task.assigneeId);
    if (target === "COLLABORATORS") for (const follower of await repo.listFollowers(task.id)) to.add(follower.id);
    if (target === "PROJECT_OWNERS") for (const id of await projectOwnerIds(rule.projectId)) to.add(id);
  }
  const messages: NotifyInput[] = [];
  let hidden = 0;
  for (const id of to) {
    const user = await findUserById(id);
    if (!user || !user.active || user.isSystem) continue;
    const viewer = await workViewer({ id: user.id, roles: user.roles, modules: user.modules });
    if (!(await rightsOn(task, viewer)).view) {
      hidden += 1;
      continue;
    }
    messages.push(automationMessages.notify({ id: task.id, taskNo: task.taskNo, title: task.title, dueAt: task.dueAt }, id, rule.name, step.text ?? ""));
  }
  await tell(messages);
  return done(`${messages.length} told${hidden ? `; ${hidden} can't see the task, so weren't` : ""}.`);
}

// ---- events ------------------------------------------------------------------------------------
let running: Promise<{ events: number; runs: number }> | null = null;
// Claims and handles waiting events until none are left (bounded). One loop
// per process at a time; a second call waits for the running one.
export function processAutomationEvents(limits: { maxEvents?: number; maxMs?: number } = {}): Promise<{ events: number; runs: number }> {
  if (running) return running;
  running = (async () => {
    let events = 0;
    let runs = 0;
    try {
      if (!(await automationsLive())) return { events, runs };
      const started = Date.now();
      const maxEvents = limits.maxEvents ?? 1000;
      const maxMs = limits.maxMs ?? 25_000;
      while (events < maxEvents && Date.now() - started < maxMs) {
        const batch = await autoRepo.claimEvents(50);
        if (!batch.length) break;
        for (const event of batch) {
          try {
            runs += await handleEvent(event);
          } catch (error) {
            logError(`automation event ${event.id} failed`, error);
          }
          await autoRepo.finishEvent(event.id);
          events += 1;
        }
      }
    } finally {
      running = null;
    }
    return { events, runs };
  })();
  return running;
}

async function handleEvent(event: AutomationEvent): Promise<number> {
  const task = await findTask(event.taskId);
  if (!task || task.deletedAt) return 0;
  const links = await repo.listTaskProjects(task.id);
  const projectIds = [...new Set([...links.map((link) => link.projectId), ...(typeof event.payload?.projectId === "number" ? [event.payload.projectId] : [])])];
  const rules = await autoRepo.liveRulesFor(projectIds, EVENT_TRIGGERS);
  let runs = 0;
  const facts = new Map<string, TaskFacts>();
  for (const rule of rules) {
    if (!rule.published?.trigger || rule.pausedReason) continue;
    const key = `${rule.projectId}:${rule.ownerId}`;
    if (!facts.has(key)) facts.set(key, await factsFor(task, rule.projectId, rule.ownerId));
    if (!eventMatches(rule.published.trigger, event, rule.projectId, facts.get(key)!)) continue;
    const result = await runRule(rule, task, { key: `e${event.id}`, depth: event.depth, chain: event.chain });
    if (result.status !== "NONE") runs += 1;
  }
  return runs;
}

// ---- time triggers and the schedule (job runner) -----------------------------------------------
async function dueTasks(rule: RuleRecord, kind: "soon" | "late", days: number, limit: number): Promise<number[]> {
  const today = indiaDay(new Date());
  const keyExpr = kind === "soon" ? `CONCAT('soon:', t.id, ':', DATE_FORMAT(t.due_at, '%Y%m%d%H%i'), ':', ${Number(days)})` : "CONCAT('late:', t.id, ':', DATE_FORMAT(t.due_at, '%Y%m%d%H%i'))";
  const where =
    kind === "soon"
      ? "DATE(DATE_ADD(t.due_at, INTERVAL 330 MINUTE)) = ?"
      : // BR-AUTO-002 (not retroactive): only tasks that became overdue after the rule was published, within the last 2 days.
        "t.due_at < UTC_TIMESTAMP() AND t.due_at >= GREATEST(?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY))";
  const param = kind === "soon" ? addDays(today, days) : (rule.publishedAt ?? new Date());
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT t.id FROM task_projects tp JOIN tasks t ON t.id = tp.task_id
     WHERE tp.project_id = ? AND t.deleted_at IS NULL AND t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at IS NOT NULL AND ${where}
       AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.automation_id = ? AND r.run_key = ${keyExpr})
     ORDER BY t.due_at, t.id LIMIT ?`,
    [rule.projectId, param, rule.id, limit],
  );
  return rows.map((row) => Number(row.id));
}
const dueKey = (task: TaskRecord) => (task.dueAt ? new Date(task.dueAt.getTime()).toISOString().replace(/[-:T]/g, "").slice(0, 12) : "");

export async function runTimedAutomations(now = new Date()): Promise<{ dueRuns: number; scheduledRuns: number }> {
  let dueRuns = 0;
  let scheduledRuns = 0;
  if (!(await automationsLive())) return { dueRuns, scheduledRuns };
  for (const rule of await autoRepo.liveRulesOfType(["DUE_APPROACHING", "OVERDUE"])) {
    const trigger = rule.published?.trigger;
    if (!trigger) continue;
    const kind = trigger.type === "OVERDUE" ? "late" : "soon";
    const days = trigger.days ?? 0;
    for (const id of await dueTasks(rule, kind, days, SCHEDULED_TASK_CAP)) {
      const task = await findTask(id);
      if (!task?.dueAt) continue;
      // The key matches the SQL's: MySQL formats due_at in UTC (the pool's time zone).
      const key = kind === "soon" ? `soon:${id}:${dueKey(task)}:${days}` : `late:${id}:${dueKey(task)}`;
      const result = await runRule(rule, task, { key });
      if (result.status !== "NONE") dueRuns += 1;
      if (result.status === "SKIPPED" && /limit/.test(result.error ?? "")) break;
    }
  }
  const clock = indiaClock(now);
  for (const rule of await autoRepo.liveRulesOfType(["SCHEDULED"])) {
    const trigger = rule.published?.trigger;
    if (!trigger || !scheduleDue(trigger, clock, rule.scheduledOn)) continue;
    if (!(await autoRepo.claimScheduledDay(rule.id, clock.day))) continue;
    const [rows] = await db().query<RowDataPacket[]>(
      "SELECT t.id FROM task_projects tp JOIN tasks t ON t.id = tp.task_id WHERE tp.project_id = ? AND t.deleted_at IS NULL AND t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') ORDER BY tp.section_id, tp.position LIMIT 2000",
      [rule.projectId],
    );
    let handled = 0;
    for (const row of rows) {
      if (handled >= SCHEDULED_TASK_CAP) break;
      const task = await findTask(Number(row.id));
      if (!task) continue;
      const facts = await factsFor(task, rule.projectId, rule.ownerId);
      if (!conditionsMatch(trigger.filter ?? [], "ALL", facts, clock.day)) continue;
      handled += 1;
      const result = await runRule(rule, task, { key: `day:${clock.day}:${task.id}` });
      if (result.status !== "NONE") scheduledRuns += 1;
      if (result.status === "SKIPPED" && /limit/.test(result.error ?? "")) break;
    }
  }
  return { dueRuns, scheduledRuns };
}

// The job runner's step: waiting events, time triggers, then housekeeping.
export async function runAutomationStep(now = new Date()): Promise<Record<string, number>> {
  const purge = await autoRepo.purgeAutomationData();
  if (!(await automationsLive())) return { ...purge, events: 0, runs: 0, dueRuns: 0, scheduledRuns: 0 };
  const events = await processAutomationEvents();
  const timed = await runTimedAutomations(now);
  return { ...purge, ...events, ...timed };
}

// ---- manual and webhook starts -----------------------------------------------------------------
export async function runManually(rule: RuleRecord, task: TaskRecord): Promise<RunResult> {
  return runRule(rule, task, { key: `m:${randomUUID()}` });
}

export interface WebhookInput {
  task?: unknown; // UPDATE: the task number (TSK-…) or the project's ID field value (PO-12)
  title?: unknown;
  name?: unknown;
  description?: unknown;
  dueDate?: unknown;
  priority?: unknown;
}
export type WebhookOutcome = { ok: true; status: number; taskId: number; taskNo: string; run: RunResult; created: boolean } | { ok: false; status: number; message: string };

async function findTaskByRef(projectId: number, ref: string): Promise<TaskRecord | null> {
  const [byNo] = await db().query<RowDataPacket[]>("SELECT t.id FROM tasks t JOIN task_projects tp ON tp.task_id = t.id AND tp.project_id = ? WHERE t.task_no = ? AND t.deleted_at IS NULL LIMIT 1", [projectId, ref]);
  let id = byNo[0] ? Number(byNo[0].id) : null;
  if (id === null) {
    const [byField] = await db().query<RowDataPacket[]>(
      `SELECT v.task_id FROM task_field_values v JOIN project_fields f ON f.id = v.field_id AND f.kind = 'ID' AND f.deleted_at IS NULL
       JOIN project_field_links l ON l.field_id = f.id AND l.project_id = ? AND l.removed_at IS NULL
       JOIN task_projects tp ON tp.task_id = v.task_id AND tp.project_id = l.project_id WHERE v.value = ? LIMIT 1`,
      [projectId, ref],
    );
    id = byField[0] ? Number(byField[0].task_id) : null;
  }
  return id === null ? null : findTask(id);
}

// A web request to a rule's address (already authenticated by the route):
// creates a task or finds one by its number / ID field, then runs the steps.
export async function handleWebhook(rule: RuleRecord, input: WebhookInput, idempotencyKey: string | null): Promise<WebhookOutcome> {
  const trigger = rule.published?.trigger;
  if (!trigger || trigger.type !== "WEBHOOK" || !rule.enabled || rule.pausedReason) return { ok: false, status: 409, message: "This automation isn't switched on." };
  const actor = await ownerActorFor(rule);
  if (!actor || !(await ownerMayRun(rule))) {
    await pauseRule(rule, `Paused: ${OWNER_LOST}`);
    return { ok: false, status: 409, message: "This automation is paused." };
  }
  const systemId = await systemUserId();
  if (!systemId) return { ok: false, status: 503, message: "Not available." };
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
  const title = text(input.title ?? input.name, 200);
  const dueDate = text(input.dueDate, 10);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, status: 400, message: "dueDate must be YYYY-MM-DD." };
  const priority = text(input.priority, 20).toUpperCase();
  if (priority && !(TASK_PRIORITIES as readonly string[]).includes(priority)) return { ok: false, status: 400, message: `priority must be one of ${TASK_PRIORITIES.join(", ")}.` };
  const key = idempotencyKey ? `w:${idempotencyKey}` : `w:${randomUUID()}`;
  // The same Idempotency-Key again: the first call's answer, nothing done twice.
  const earlier = idempotencyKey ? await autoRepo.findRunByKey(rule.id, key) : null;
  if (earlier?.taskId) return { ok: true, status: 200, taskId: earlier.taskId, taskNo: earlier.taskNo ?? "", run: none, created: false };
  const context = { ruleId: rule.id, ruleName: rule.name, ownerId: rule.ownerId, systemId, depth: 1, chain: [rule.id] };
  let task: TaskRecord | null = null;
  let created = false;
  if (trigger.webhookMode === "UPDATE") {
    const ref = text(input.task, 60);
    if (!ref) return { ok: false, status: 400, message: "Give the task's number or ID in \"task\"." };
    task = await findTaskByRef(rule.projectId, ref);
    if (!task) return { ok: false, status: 404, message: "No task of this project has that number or ID." };
    const change: Parameters<typeof work.setTaskFields>[1] = {};
    if (title) change.title = title;
    if (dueDate) change.dueDay = dueDate;
    if (priority) change.priority = priority;
    if (Object.keys(change).length) {
      const result = await runAsAutomation(context, () => work.setTaskFields(task!.id, { ...change, holidayOk: true }, actor));
      if (!result.ok) return { ok: false, status: 422, message: result.message };
    }
  } else {
    if (!title) return { ok: false, status: 400, message: "Give the new task's name in \"title\"." };
    const day = dueDate || addWorkDays(indiaDay(new Date()), 3, await workCalendar(db()), true);
    const made = await runAsAutomation(context, () =>
      work.quickAddTask({ title, description: text(input.description, 4000) || undefined, priority: priority || undefined, projectId: rule.projectId, sectionId: trigger.sectionId ?? null, parentId: null, assigneeId: trigger.assigneeId ?? rule.ownerId, dueDay: day, mySectionId: null, holidayOk: true }, actor),
    );
    if (!made.ok) return { ok: false, status: 422, message: made.message };
    task = await findTask(made.value.id);
    created = true;
  }
  if (!task) return { ok: false, status: 500, message: "Failed." };
  const run = await runRule(rule, task, { key });
  return { ok: true, status: created ? 201 : 200, taskId: task.id, taskNo: task.taskNo, run, created };
}

export const stepCount = allSteps;
