import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import * as autoRepo from "@/lib/db/repositories/automations.repository";
import type { RuleRecord, RunRecord } from "@/lib/db/repositories/automations.repository";
import { findTask } from "@/lib/db/repositories/tasks.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import * as fieldsRepo from "@/lib/db/repositories/fields.repository";
import { findUserById } from "@/lib/db/repositories/users.repository";
import { appBaseUrl } from "@/lib/http/app-url";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import type { TaskActor } from "@/server/modules/tasks";
import { featureOn } from "@/server/settings/features";
import { projectAbilities, type WorkViewer } from "@/server/work/access";
import { mayCustomise } from "@/server/work/custom-fields";
import { loadSetting } from "@/server/work/holiday-store";
import { rightsOn, workViewer } from "@/server/work/task-access";
import {
  allSteps,
  AUTOMATION_LIMITS_KEY,
  checkRule,
  definitionSchema,
  describeTrigger,
  EMPTY_DEFINITION,
  parseAutomationLimits,
  RULE_NAME_MAX,
  type AutomationLimits,
  type CheckContext,
  type FieldInfo,
  type RuleDefinition,
  type RuleProblem,
} from "@/server/work/automation-rules";
import { namesFor, OWNER_LOST, ownerMayRun, runManually, type RunResult } from "@/server/work/automation-engine";
import { newWebhookSecret, newWebhookToken } from "@/server/work/automation-webhook";

// v1.68.0 (D-380, PM phase D part 2): project automations, the builder side.
// Every operation checks the "pm_automations" switch and who may do it on the
// server (deny by default). Builders: the project's owners and editors (only
// owners with "Only admins customise"; the D-371 mayCustomise). Owners and
// editors see the list and run logs; "Run on this task" is for the project's
// owners and editors. A rule always acts with its owner's rights.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; problems?: RuleProblem[] };
const fail = (message: string, problems?: RuleProblem[]): { ok: false; message: string; problems?: RuleProblem[] } => ({ ok: false, message, problems });
const NOT_FOUND = "Not found.";
const OFF = "Project automations aren't switched on yet.";
const db = () => getDbPool();
export const webhookUrl = (token: string) => `${appBaseUrl()}/api/webhooks/automations/${token}`;

export async function automationsOn(actor: { roles: readonly string[] }): Promise<boolean> {
  return featureOn("pm_automations", actor).catch(() => false);
}
export async function automationLimits(): Promise<AutomationLimits> {
  return parseAutomationLimits(await loadSetting(AUTOMATION_LIMITS_KEY).catch(() => null));
}

async function projectAccess(projectId: number, actor: TaskActor) {
  const viewer = await workViewer(actor);
  const found = await repo.projectFor(projectId, viewer);
  if (!found || found.project.isTemplate || found.project.deletedAt) return null;
  const edit = projectAbilities(found.role).edit;
  return { ...found, viewer, see: edit, build: edit && mayCustomise(found.role, found.project.permissions.customise, viewer.isAdmin) };
}
const buildRefusal = (customise: "EDITOR" | "OWNER") => (customise === "OWNER" ? "Only the project's admins (owners) build its automations." : "Only the project's owners and editors build its automations.");
type Access = NonNullable<Awaited<ReturnType<typeof projectAccess>>>;
async function ruleFor(ruleId: number, actor: TaskActor, need: "see" | "build"): Promise<{ error: string } | { rule: RuleRecord; access: Access }> {
  if (!(await automationsOn(actor))) return { error: OFF };
  const rule = await autoRepo.findRule(ruleId);
  if (!rule) return { error: NOT_FOUND };
  const access = await projectAccess(rule.projectId, actor);
  if (!access || !access.see) return { error: NOT_FOUND };
  if (need === "build" && !access.build) return { error: buildRefusal(access.project.permissions.customise) };
  return { rule, access };
}
const audit = (actor: TaskActor, action: string, ruleId: number, metadata?: Record<string, unknown>) => ({ actorUserId: actor.id, action, entityType: "PROJECT_AUTOMATION", entityId: ruleId, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: metadata ?? null });

// ---- what the checks need --------------------------------------------------------------------
async function activePeople(): Promise<Set<number>> {
  const [rows] = await db().query<RowDataPacket[]>("SELECT id FROM users WHERE active = TRUE AND is_system = FALSE");
  return new Set(rows.map((row) => Number(row.id)));
}
async function fieldInfo(projectId: number): Promise<FieldInfo[]> {
  return (await fieldsRepo.listFieldDefs(projectId)).map((field) => ({ id: field.id, name: field.name, type: field.type, options: field.options.map((option) => ({ id: option.id, name: option.name, archived: option.archived })) }));
}
async function formIds(projectId: number): Promise<{ id: number; name: string }[]> {
  const [rows] = await db().query<RowDataPacket[]>("SELECT id, name FROM project_forms WHERE project_id = ? AND deleted_at IS NULL ORDER BY id", [projectId]);
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
}
async function ownerViewer(ownerId: number): Promise<WorkViewer | null> {
  const owner = await findUserById(ownerId);
  if (!owner || !owner.active || owner.isSystem) return null;
  return workViewer({ id: owner.id, roles: owner.roles, modules: owner.modules });
}
// The projects the owner may add tasks to (owner or editor), with sections.
// Only `wanted` are checked when given (publish); else the owner's own projects (the picker).
async function targetProjects(ownerId: number, wanted?: readonly number[]): Promise<Map<number, { name: string; sections: { id: number; name: string }[] }>> {
  const out = new Map<number, { name: string; sections: { id: number; name: string }[] }>();
  const viewer = await ownerViewer(ownerId);
  if (!viewer) return out;
  const ids = wanted ?? (await repo.listVisibleProjects(viewer, { onlyMine: true })).slice(0, 60).map((project) => project.id);
  for (const id of new Set(ids)) {
    const found = await repo.projectFor(id, viewer);
    if (!found || found.project.isTemplate || found.project.archivedAt || !projectAbilities(found.role).edit) continue;
    out.set(id, { name: found.project.name, sections: (await repo.listSections(id)).map((section) => ({ id: section.id, name: section.name })) });
  }
  return out;
}
async function checkContextFor(rule: Pick<RuleRecord, "projectId" | "ownerId">, def: RuleDefinition): Promise<CheckContext> {
  const wanted = allSteps(def).filter((step) => step.type === "ADD_TO_PROJECT" && step.projectId).map((step) => step.projectId!);
  const [sections, fields, forms, people, targets, limits] = await Promise.all([repo.listSections(rule.projectId), fieldInfo(rule.projectId), formIds(rule.projectId), activePeople(), targetProjects(rule.ownerId, wanted), automationLimits()]);
  return {
    sectionIds: sections.map((section) => section.id),
    fields,
    formIds: forms.map((form) => form.id),
    activePeople: people,
    targetProjects: new Map([...targets].map(([id, project]) => [id, project.sections.map((section) => section.id)])),
    maxSteps: limits.stepsPerRule,
  };
}
export async function problemsFor(rule: Pick<RuleRecord, "projectId" | "ownerId">, name: string, def: RuleDefinition): Promise<RuleProblem[]> {
  return checkRule(name, def, await checkContextFor(rule, def));
}

// ---- the list (Customize → Automations) -------------------------------------------------------
export interface RuleRow {
  id: number;
  name: string;
  trigger: string;
  published: boolean;
  version: number;
  draftChanged: boolean;
  enabled: boolean;
  paused: string | null;
  ownerName: string;
  lastRunAt: string | null;
  lastResult: string | null;
}
export async function projectRulesFor(projectId: number, actor: TaskActor): Promise<{ rows: RuleRow[]; build: boolean; limit: number } | null> {
  if (!(await automationsOn(actor))) return null;
  const access = await projectAccess(projectId, actor);
  if (!access?.see) return null;
  const [rules, names, limits] = await Promise.all([autoRepo.listProjectRules(projectId), namesFor(projectId), automationLimits()]);
  return {
    build: access.build,
    limit: limits.perProject,
    rows: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      trigger: describeTrigger((rule.published ?? rule.draft).trigger, names),
      published: Boolean(rule.published),
      version: rule.publishedVersion,
      draftChanged: rule.draftChanged,
      enabled: rule.enabled,
      paused: rule.pausedReason,
      ownerName: rule.ownerName,
      lastRunAt: rule.lastRunAt?.toISOString() ?? null,
      lastResult: rule.lastResult,
    })),
  };
}

export async function createRule(projectId: number, actor: TaskActor): Promise<Result<{ id: number }>> {
  if (!(await automationsOn(actor))) return fail(OFF);
  const access = await projectAccess(projectId, actor);
  if (!access?.see) return fail(NOT_FOUND);
  if (!access.build) return fail(buildRefusal(access.project.permissions.customise));
  const limits = await automationLimits();
  const id = await withTransaction(async (connection) => {
    await repo.findProject(projectId, connection, true);
    if ((await autoRepo.countProjectRules(projectId, connection)) >= limits.perProject) return null;
    // BR-PROJ-081: a new rule starts as an untitled draft, owned by its creator.
    const ruleId = await autoRepo.insertRule({ projectId, name: "Untitled automation", ownerId: actor.id, draft: EMPTY_DEFINITION, createdBy: actor.id }, connection);
    await repo.appendProjectEvent(projectId, actor.id, "AUTOMATION_ADDED", "Untitled automation", connection);
    await recordAudit(audit(actor, "PROJECT_AUTOMATION_CREATED", ruleId, { projectId }), connection);
    return ruleId;
  });
  if (id === null) return fail(`A project has at most ${limits.perProject} automations (Admin → Task settings).`);
  return { ok: true, value: { id }, message: "Automation added." };
}

// ---- the builder ------------------------------------------------------------------------------
export interface BuilderData {
  rule: RuleRecord;
  projectName: string;
  build: boolean;
  isOwner: boolean;
  ownerCanRun: boolean;
  sections: { id: number; name: string }[];
  fields: FieldInfo[];
  forms: { id: number; name: string }[];
  projects: { id: number; name: string; sections: { id: number; name: string }[] }[];
  problems: RuleProblem[];
  webhookUrl: string | null;
  runs: RunRecord[];
  deliveries: Awaited<ReturnType<typeof autoRepo.listDeliveries>>;
  limits: AutomationLimits;
}
export async function builderData(ruleId: number, actor: TaskActor): Promise<BuilderData | null> {
  const found = await ruleFor(ruleId, actor, "see");
  if ("error" in found) return null;
  const { rule, access } = found;
  const [sections, fields, forms, targets, runs, deliveries, limits, ownerCanRun] = await Promise.all([
    repo.listSections(rule.projectId),
    fieldInfo(rule.projectId),
    formIds(rule.projectId),
    targetProjects(rule.ownerId),
    autoRepo.listRuns(rule.id),
    autoRepo.listDeliveries(rule.id),
    automationLimits(),
    ownerMayRun(rule),
  ]);
  return {
    rule,
    projectName: access.project.name,
    build: access.build,
    isOwner: rule.ownerId === actor.id,
    ownerCanRun,
    sections: sections.map((section) => ({ id: section.id, name: section.name })),
    fields,
    forms,
    projects: [...targets].filter(([id]) => id !== rule.projectId).map(([id, project]) => ({ id, ...project })),
    problems: await problemsFor(rule, rule.name, rule.draft),
    webhookUrl: rule.webhookToken ? webhookUrl(rule.webhookToken) : null,
    runs,
    deliveries,
    limits,
  };
}

export function readRuleInput(raw: unknown): { ok: true; value: { name: string; draft: RuleDefinition; rowVersion: number } } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object") return { ok: false, message: "Check the rule." };
  const input = raw as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  if (name.length > RULE_NAME_MAX) return { ok: false, message: `Use ${RULE_NAME_MAX} characters or fewer for the name.` };
  const draft = definitionSchema.safeParse(input.draft);
  if (!draft.success) return { ok: false, message: "Check the rule's cards." };
  const rowVersion = typeof input.rowVersion === "number" && Number.isInteger(input.rowVersion) ? input.rowVersion : -1;
  return { ok: true, value: { name, draft: draft.data, rowVersion } };
}

export async function saveRule(ruleId: number, raw: unknown, actor: TaskActor): Promise<Result<{ rowVersion: number; problems: RuleProblem[] }>> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  const input = readRuleInput(raw);
  if (!input.ok) return fail(input.message);
  const { name, draft, rowVersion } = input.value;
  const saved = await withTransaction(async (connection) => {
    if (!(await autoRepo.saveDraft(ruleId, rowVersion, { name: name || found.rule.name, draft }, actor.id, connection))) return null;
    await recordAudit(audit(actor, "PROJECT_AUTOMATION_SAVED", ruleId, { steps: allSteps(draft).length }), connection);
    return rowVersion + 1;
  });
  if (saved === null) return fail("Someone else changed this automation. Reload the page to see the latest, then try again.");
  return { ok: true, value: { rowVersion: saved, problems: await problemsFor(found.rule, name || found.rule.name, draft) }, message: "Draft saved." };
}

// Publish: the draft is checked as a whole (with the owner's rights for other
// projects) and becomes the version that runs; only new events use it (BR-AUTO-002).
export async function publishRule(ruleId: number, actor: TaskActor): Promise<Result<{ version: number; secret: string | null }>> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  const { rule } = found;
  const problems = await problemsFor(rule, rule.name, rule.draft);
  if (problems.length) return fail(`Fix ${problems.length === 1 ? "this" : `these ${problems.length} things`} first: ${problems[0]!.message}`, problems);
  if (!(await ownerMayRun(rule))) return fail(`The rule's owner can't run it: ${OWNER_LOST} Choose Become owner first.`);
  let secret: string | null = null;
  const version = await withTransaction(async (connection) => {
    const locked = await autoRepo.findRule(ruleId, connection, true);
    if (!locked || locked.rowVersion !== rule.rowVersion) return null;
    await autoRepo.publishRule(ruleId, rule.draft, actor.id, connection);
    // A webhook rule gets its address and secret the first time (the secret is shown once).
    if (rule.draft.trigger?.type === "WEBHOOK" && !locked.webhookToken) {
      secret = newWebhookSecret();
      await autoRepo.setWebhook(ruleId, newWebhookToken(), encryptSecret(secret), actor.id, connection);
    }
    await repo.appendProjectEvent(rule.projectId, actor.id, "AUTOMATION_PUBLISHED", `${rule.name} (version ${locked.publishedVersion + 1})`, connection);
    await recordAudit(audit(actor, "PROJECT_AUTOMATION_PUBLISHED", ruleId, { version: locked.publishedVersion + 1, trigger: rule.draft.trigger?.type }), connection);
    return locked.publishedVersion + 1;
  });
  if (version === null) return fail("Someone else changed this automation. Reload the page, then publish again.");
  return { ok: true, value: { version, secret }, message: `Published (version ${version}). It runs on new activity from now on.` };
}

export async function discardDraft(ruleId: number, actor: TaskActor): Promise<Result> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  if (!found.rule.published) return fail("There is no published version to go back to.");
  await withTransaction((connection) => autoRepo.discardDraft(ruleId, actor.id, connection));
  return { ok: true, value: undefined, message: "Draft changes discarded." };
}

export async function setRuleEnabled(ruleId: number, on: boolean, actor: TaskActor): Promise<Result> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  await withTransaction(async (connection) => {
    await autoRepo.setEnabled(ruleId, on, actor.id, connection);
    await recordAudit(audit(actor, on ? "PROJECT_AUTOMATION_ENABLED" : "PROJECT_AUTOMATION_DISABLED", ruleId), connection);
  });
  // Switching on again after a pause: allowed once the owner may run it again.
  if (on && found.rule.pausedReason && (await ownerMayRun(found.rule))) await autoRepo.setPaused(ruleId, null);
  return { ok: true, value: undefined, message: on ? "Switched on." : "Switched off: it won't run until switched on again." };
}

// WF-AUTO-06: an owner or editor takes the rule over (it then acts with their rights).
export async function becomeOwner(ruleId: number, actor: TaskActor): Promise<Result> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  if (found.rule.ownerId === actor.id && !found.rule.pausedReason) return fail("You already own this automation.");
  await withTransaction(async (connection) => {
    await autoRepo.setOwner(ruleId, actor.id, actor.id, connection);
    await repo.appendProjectEvent(found.rule.projectId, actor.id, "AUTOMATION_OWNER", found.rule.name, connection);
    await recordAudit(audit(actor, "PROJECT_AUTOMATION_OWNER", ruleId, { from: found.rule.ownerId, to: actor.id }), connection);
  });
  return { ok: true, value: undefined, message: "You own this automation now; it acts with your rights." };
}

export async function duplicateRule(ruleId: number, actor: TaskActor): Promise<Result<{ id: number }>> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  const limits = await automationLimits();
  const { rule } = found;
  const id = await withTransaction(async (connection) => {
    await repo.findProject(rule.projectId, connection, true);
    if ((await autoRepo.countProjectRules(rule.projectId, connection)) >= limits.perProject) return null;
    const copy = await autoRepo.insertRule({ projectId: rule.projectId, name: `${rule.name} (copy)`.slice(0, RULE_NAME_MAX), ownerId: actor.id, draft: rule.draft, createdBy: actor.id }, connection);
    await repo.appendProjectEvent(rule.projectId, actor.id, "AUTOMATION_ADDED", `${rule.name} (copy)`, connection);
    await recordAudit(audit(actor, "PROJECT_AUTOMATION_CREATED", copy, { copyOf: ruleId }), connection);
    return copy;
  });
  if (id === null) return fail(`A project has at most ${limits.perProject} automations (Admin → Task settings).`);
  return { ok: true, value: { id }, message: "Duplicated as a draft (switched on once published)." };
}

export async function deleteRule(ruleId: number, actor: TaskActor): Promise<Result> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  await withTransaction(async (connection) => {
    await autoRepo.deleteRule(ruleId, connection);
    await repo.appendProjectEvent(found.rule.projectId, actor.id, "AUTOMATION_DELETED", found.rule.name, connection);
    await recordAudit(audit(actor, "PROJECT_AUTOMATION_DELETED", ruleId, { name: found.rule.name }), connection);
  });
  return { ok: true, value: undefined, message: "Automation deleted. What it already changed stays." };
}

// A new signing secret (the old one stops working); shown once.
export async function newSecret(ruleId: number, actor: TaskActor): Promise<Result<{ secret: string; url: string }>> {
  const found = await ruleFor(ruleId, actor, "build");
  if ("error" in found) return fail(found.error);
  if (found.rule.published?.trigger?.type !== "WEBHOOK" && found.rule.draft.trigger?.type !== "WEBHOOK") return fail("Only a webhook automation has a secret.");
  const secret = newWebhookSecret();
  const token = found.rule.webhookToken ?? newWebhookToken();
  await withTransaction(async (connection) => {
    await autoRepo.setWebhook(ruleId, token, encryptSecret(secret), actor.id, connection);
    await recordAudit(audit(actor, "PROJECT_AUTOMATION_SECRET", ruleId), connection);
  });
  return { ok: true, value: { secret, url: webhookUrl(token) }, message: "New secret made. Copy it now: it isn't shown again." };
}
export function webhookSecretOf(rule: Pick<RuleRecord, "webhookSecretEnc">): string | null {
  if (!rule.webhookSecretEnc) return null;
  try {
    return decryptSecret(rule.webhookSecretEnc);
  } catch {
    return null;
  }
}

// ---- running by hand ("Run on this task") -------------------------------------------------------
export async function manualRulesFor(taskId: number, actor: TaskActor): Promise<{ id: number; name: string; projectName: string }[]> {
  if (!(await automationsOn(actor))) return [];
  const task = await findTask(taskId);
  if (!task || task.deletedAt) return [];
  const viewer = await workViewer(actor);
  if (!(await rightsOn(task, viewer)).view) return [];
  const out: { id: number; name: string; projectName: string }[] = [];
  for (const link of await repo.listTaskProjects(taskId)) {
    const found = await repo.projectFor(link.projectId, viewer);
    if (!found || !projectAbilities(found.role).edit) continue;
    for (const rule of await autoRepo.liveRulesFor([link.projectId], ["MANUAL"])) if (!rule.pausedReason) out.push({ id: rule.id, name: rule.name, projectName: link.projectName });
  }
  return out;
}
export async function runOnTask(ruleId: number, taskId: number, actor: TaskActor): Promise<Result<RunResult>> {
  const found = await ruleFor(ruleId, actor, "see");
  if ("error" in found) return fail(found.error);
  const { rule } = found;
  if (rule.published?.trigger?.type !== "MANUAL" || !rule.enabled) return fail("This automation can't be run by hand.");
  if (rule.pausedReason) return fail("This automation is paused. An owner or editor can choose Become owner to start it again.");
  const task = await findTask(taskId);
  if (!task || task.deletedAt) return fail(NOT_FOUND);
  if (!(await rightsOn(task, found.access.viewer)).view) return fail(NOT_FOUND);
  if (!(await repo.listTaskProjects(taskId)).some((link) => link.projectId === rule.projectId)) return fail("The task isn't in this automation's project.");
  const result = await runManually(rule, task);
  if (result.status === "SUCCEEDED") return { ok: true, value: result, message: `“${rule.name}” ran.` };
  if (result.status === "NONE") return fail("It didn't run (it may be paused or switched off).");
  return { ok: false, message: `“${rule.name}” ${result.status === "SKIPPED" ? "didn't run" : "stopped"}: ${result.error ?? "see its run log."}` };
}
