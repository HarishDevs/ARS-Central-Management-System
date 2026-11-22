import "server-only";
import { z } from "zod";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { insertOutbox } from "@/lib/db/repositories/outbox.repository";
import { afterResponse } from "@/lib/http/after-response";
import { logError } from "@/lib/logging/logger";
import * as repo from "@/lib/db/repositories/portfolios.repository";
import type { PortfolioRecord, ProjectInfo } from "@/lib/db/repositories/portfolios.repository";
import { deliverOutbox } from "@/server/approvals/service";
import { portfolioMessages } from "@/server/modules/messages";
import type { TaskActor } from "@/server/modules/tasks";
import { featureMode, featureOn } from "@/server/settings/features";
import { leavesAnOwner, PRIVACY, PROJECT_COLORS, PROJECT_ROLE_LABEL, PROJECT_ROLES, STATUS_KIND_LABEL, STATUS_KINDS, type ProjectRole, type ProjectStatusKind, type WorkViewer } from "@/server/work/access";
import {
  checkFieldValue,
  effectivePortfolioRole,
  fieldInputSchema,
  maskRow,
  NESTING_MESSAGE,
  nestingProblem,
  NO_COUNTS,
  PORTFOLIO_LIMITS,
  portfolioAbilities,
  PRIORITIES,
  rolledUpProjects,
  statusInputSchema,
  statusProblem,
  type ItemLink,
  type PortfolioRow,
  type TaskCounts,
  type VisibleRow,
} from "@/server/work/portfolio-rules";
import { assembleChart, burnChart, chartConfigSchema, rangeDays, timeBuckets, type ChartData, type GroupRow } from "@/server/work/reporting";
import { indiaDay } from "@/server/work/rules";
import { workViewer } from "@/server/work/task-access";

// v1.69.0 (D-382, PM phase D part 3, spec PORTFOLIOS_MODULE): portfolios.
// Every operation checks the "pm_portfolios" switch, the Projects module
// and the person's role in the portfolio on the server (deny by default: a
// portfolio they can't see is "Not found."). Seeing a portfolio never opens
// its projects: rows for projects (or portfolios) the person can't see are
// masked ("Private project"), and every figure counts only what they can see.
type Result<T = undefined> = { ok: true; value: T; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };
const fail = (message: string, fieldErrors?: Record<string, string>): { ok: false; message: string; fieldErrors?: Record<string, string> } => ({ ok: false, message, ...(fieldErrors ? { fieldErrors } : {}) });
const NOT_FOUND = "Not found.";
export const PORTFOLIOS_OFF = "Portfolios aren't switched on yet.";
const ONLY_EDITORS = "Only the portfolio's owners and editors can do that.";
const ONLY_OWNERS = "Only the portfolio's owners can do that.";

export async function portfoliosOn(actor: { roles: readonly string[] }): Promise<boolean> {
  return featureOn("pm_portfolios", actor).catch(() => false);
}
const audit = (actor: TaskActor, action: string, id: number, metadata: Record<string, unknown> = {}) => ({ actorUserId: actor.id, action, entityType: "PORTFOLIO", entityId: id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata });
async function send(ids: number[]) {
  if (ids.length) await afterResponse("portfolio messages", () => deliverOutbox(ids));
}

// The portfolio with the person's role, or null (switch off, no Projects module, not visible, deleted).
export async function portfolioFor(id: number, actor: TaskActor, options: { deleted?: boolean } = {}) {
  if (!(await portfoliosOn(actor))) return null;
  const viewer = await workViewer(actor);
  if (viewer.projects === false) return null;
  const portfolio = await repo.findPortfolio(id);
  if (!portfolio || (portfolio.deletedAt && !options.deleted)) return null;
  const members = await repo.listPortfolioMembers(id);
  const role = effectivePortfolioRole({ privacy: portfolio.privacy, departmentId: portfolio.departmentId, defaultAccessRole: portfolio.defaultAccessRole, members }, viewer);
  if (!role) return null;
  return { portfolio, members, role, can: portfolioAbilities(role), viewer };
}

// ---- create and change ----------------------------------------------------------------------
const roleSchema = z.enum(PROJECT_ROLES);
const createSchema = z.object({
  name: z.string().trim().min(1, "Give your portfolio a name.").max(PORTFOLIO_LIMITS.name, `At most ${PORTFOLIO_LIMITS.name} characters.`),
  color: z.enum(PROJECT_COLORS).default("blue"),
  privacy: z.enum(PRIVACY).default("PRIVATE"),
  departmentId: z.number().int().positive().nullable().default(null),
  defaultTab: z.enum(["LIST", "TIMELINE", "PROGRESS", "DASHBOARD"]).default("LIST"),
  description: z.string().trim().max(PORTFOLIO_LIMITS.description).default(""),
  projectIds: z.array(z.number().int().positive()).max(100).default([]),
  portfolioIds: z.array(z.number().int().positive()).max(50).default([]),
  members: z.array(z.object({ id: z.number().int().positive(), role: roleSchema })).max(50).default([]),
});
export type CreatePortfolioInput = z.input<typeof createSchema>;
const firstError = (error: z.ZodError) => {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  return fail(Object.values(fieldErrors)[0] ?? "Check the details.", fieldErrors);
};

export async function createPortfolio(raw: unknown, actor: TaskActor): Promise<Result<{ id: number }>> {
  if (!(await portfoliosOn(actor))) return fail(PORTFOLIOS_OFF);
  const viewer = await workViewer(actor);
  if (viewer.projects === false) return fail(NOT_FOUND);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return firstError(parsed.error);
  const input = parsed.data;
  const departmentId = input.privacy === "DEPARTMENT" ? (input.departmentId ?? viewer.departmentId) : input.departmentId;
  if (input.privacy === "DEPARTMENT" && !departmentId) return fail("Choose the department that may see it.", { departmentId: "Choose a department." });
  // Only work the person can see goes in (deny by default).
  const projectIds = [...new Set(input.projectIds)];
  const portfolioIds = [...new Set(input.portfolioIds)];
  const [seenProjects, seenPortfolios] = await Promise.all([repo.visibleProjectIds(viewer, projectIds), repo.visiblePortfolioIds(viewer, portfolioIds)]);
  if (projectIds.some((id) => !seenProjects.has(id)) || portfolioIds.some((id) => !seenPortfolios.has(id))) return fail("Some of the chosen work isn't available to you. Reload and try again.");
  const memberIds = [...new Set(input.members.map((member) => member.id).filter((id) => id !== actor.id))];
  const allowed = new Set(await repo.withProjectsModule(memberIds));
  if (memberIds.some((id) => !allowed.has(id))) return fail("Some of the chosen people can't use Projects.", { members: "Choose people who can use Projects." });
  const { id, outbox } = await withTransaction(async (connection) => {
    const id = await repo.insertPortfolio(
      { name: input.name, color: input.color, ownerId: actor.id, privacy: input.privacy, departmentId: departmentId ?? null, defaultAccessRole: "VIEWER", description: input.description || null, defaultTab: input.defaultTab },
      connection,
    );
    await repo.setPortfolioMember(id, actor.id, "OWNER", actor.id, connection);
    for (const projectId of projectIds) await repo.insertItem(id, { projectId, childId: null }, actor.id, connection);
    for (const childId of portfolioIds) await repo.insertItem(id, { projectId: null, childId }, actor.id, connection); // a new portfolio can't make a circle
    const messages = [];
    for (const member of input.members.filter((item) => allowed.has(item.id))) {
      await repo.setPortfolioMember(id, member.id, member.role, actor.id, connection);
      messages.push(portfolioMessages.added({ id, name: input.name }, member.id, actor.name, PROJECT_ROLE_LABEL[member.role]));
    }
    await recordAudit(audit(actor, "PORTFOLIO_CREATED", id, { privacy: input.privacy, projects: projectIds.length, portfolios: portfolioIds.length, members: messages.length }), connection);
    return { id, outbox: await insertOutbox(null, messages, connection) };
  });
  await send(outbox);
  return { ok: true, value: { id }, message: "Portfolio created." };
}

const detailsSchema = z.object({
  name: z.string().trim().min(1, "Give your portfolio a name.").max(PORTFOLIO_LIMITS.name).optional(),
  color: z.enum(PROJECT_COLORS).optional(),
  description: z.string().trim().max(PORTFOLIO_LIMITS.description).optional(),
  privacy: z.enum(PRIVACY).optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  defaultAccessRole: z.enum(["EDITOR", "COMMENTER", "VIEWER"]).optional(),
  ownerId: z.number().int().positive().optional(),
  startOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter a date.").optional(),
  dueOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter a date.").optional(),
  defaultTab: z.enum(["LIST", "TIMELINE", "PROGRESS", "DASHBOARD"]).optional(),
  rowVersion: z.number().int().nonnegative().optional(),
});
// Colour: owners and editors (spec: editors may Set colour). Everything else: owners.
export async function updatePortfolio(id: number, raw: unknown, actor: TaskActor): Promise<Result> {
  const found = await portfolioFor(id, actor);
  if (!found) return fail(NOT_FOUND);
  const parsed = detailsSchema.safeParse(raw);
  if (!parsed.success) return firstError(parsed.error);
  const input = parsed.data;
  const ownerOnly = Object.keys(input).some((key) => key !== "color" && key !== "rowVersion");
  if (ownerOnly ? !found.can.manage : !found.can.edit) return fail(ownerOnly ? ONLY_OWNERS : ONLY_EDITORS);
  const changes: Record<string, unknown> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.color !== undefined) changes.color = input.color;
  if (input.description !== undefined) changes.description = input.description || null;
  if (input.defaultAccessRole !== undefined) changes.default_access_role = input.defaultAccessRole;
  if (input.defaultTab !== undefined) changes.default_tab = input.defaultTab;
  if (input.startOn !== undefined) changes.start_on = input.startOn || null;
  if (input.dueOn !== undefined) changes.due_on = input.dueOn || null;
  const start = input.startOn !== undefined ? input.startOn || null : found.portfolio.startOn;
  const due = input.dueOn !== undefined ? input.dueOn || null : found.portfolio.dueOn;
  if (start && due && due < start) return fail("The due date can't be before the start date.", { dueOn: "The due date can't be before the start date." });
  if (input.privacy !== undefined) {
    changes.privacy = input.privacy;
    const departmentId = input.departmentId !== undefined ? input.departmentId : found.portfolio.departmentId ?? found.viewer.departmentId;
    if (input.privacy === "DEPARTMENT" && !departmentId) return fail("Choose the department that may see it.");
    changes.department_id = departmentId ?? null;
  }
  if (input.ownerId !== undefined && input.ownerId !== found.portfolio.ownerId) {
    // The new owner must already be one of its owners (so they can see it).
    if (!found.members.some((member) => member.id === input.ownerId && member.role === "OWNER")) return fail("Make the person an owner in Share first.", { ownerId: "Choose one of the portfolio's owners." });
    changes.owner_id = input.ownerId;
  }
  const saved = await withTransaction(async (connection) => {
    const done = await repo.updatePortfolio(id, changes, connection, input.rowVersion);
    if (done) await recordAudit(audit(actor, "PORTFOLIO_UPDATED", id, { changed: Object.keys(changes) }), connection);
    return done;
  });
  return saved ? { ok: true, value: undefined, message: "Saved." } : fail("Someone changed this portfolio while you were looking. Reload and try again.");
}

export type PortfolioCommand = "ARCHIVE" | "UNARCHIVE" | "DELETE" | "RESTORE" | "JOIN" | "LEAVE" | "STAR";
export async function portfolioCommand(id: number, command: PortfolioCommand, actor: TaskActor): Promise<Result> {
  const found = await portfolioFor(id, actor, { deleted: command === "RESTORE" });
  if (!found) return fail(NOT_FOUND);
  const { portfolio, members, can } = found;
  if (command === "STAR") {
    const on = await repo.toggleStar(actor.id, id);
    return { ok: true, value: undefined, message: on ? "Starred." : "Unstarred." };
  }
  if (command === "JOIN") {
    if (members.some((member) => member.id === actor.id)) return { ok: true, value: undefined, message: "You're already a member." };
    await withTransaction(async (connection) => {
      await repo.setPortfolioMember(id, actor.id, portfolio.defaultAccessRole, actor.id, connection);
      await recordAudit(audit(actor, "PORTFOLIO_JOINED", id), connection);
    });
    return { ok: true, value: undefined, message: "You joined the portfolio." };
  }
  if (command === "LEAVE") {
    const me = members.find((member) => member.id === actor.id);
    if (!me) return fail("You aren't a member.");
    if (!leavesAnOwner(members.map((member) => ({ type: "USER" as const, id: member.id, role: member.role })), { type: "USER", id: actor.id, role: null })) return fail("Make someone else an owner before you leave.");
    await withTransaction(async (connection) => {
      await repo.removePortfolioMember(id, actor.id, connection);
      await recordAudit(audit(actor, "PORTFOLIO_LEFT", id), connection);
    });
    return { ok: true, value: undefined, message: "You left the portfolio." };
  }
  if (!can.manage) return fail(ONLY_OWNERS);
  const change =
    command === "ARCHIVE" ? { archived_at: new Date() } : command === "UNARCHIVE" ? { archived_at: null } : command === "DELETE" ? { deleted_at: new Date(), deleted_by: actor.id } : { deleted_at: null, deleted_by: null };
  if (command === "RESTORE" && !portfolio.deletedAt) return { ok: true, value: undefined, message: "It isn't deleted." };
  await withTransaction(async (connection) => {
    await repo.updatePortfolio(id, change, connection);
    await recordAudit(audit(actor, `PORTFOLIO_${command}D`, id), connection);
  });
  const message = { ARCHIVE: "Portfolio archived.", UNARCHIVE: "Portfolio restored from the archive.", DELETE: "Portfolio deleted. It stays in Deleted for 30 days; its projects are not touched.", RESTORE: "Portfolio restored." }[command];
  return { ok: true, value: undefined, message };
}

// ---- people ----------------------------------------------------------------------------------
// Editors add people and change non-owner roles; only owners grant or take
// away ownership; there is always an owner left.
export async function setPortfolioMember(id: number, userId: number, role: string | null, actor: TaskActor): Promise<Result> {
  const found = await portfolioFor(id, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.share) return fail(ONLY_EDITORS);
  const next = role === null ? null : roleSchema.safeParse(role).success ? (role as ProjectRole) : undefined;
  if (next === undefined) return fail("Choose a role.");
  const current = found.members.find((member) => member.id === userId);
  if ((next === "OWNER" || current?.role === "OWNER") && !found.can.manage) return fail("Only owners can add or remove owners.");
  if (!leavesAnOwner(found.members.map((member) => ({ type: "USER" as const, id: member.id, role: member.role })), { type: "USER", id: userId, role: next })) return fail("A portfolio needs at least one owner.");
  if (next && !current) {
    if (found.members.length >= PORTFOLIO_LIMITS.members) return fail(`A portfolio has at most ${PORTFOLIO_LIMITS.members} people.`);
    if (!(await repo.withProjectsModule([userId])).length) return fail("That person can't use Projects.");
  }
  if (next === null && userId === found.portfolio.ownerId) return fail("Choose another owner in Details before removing this person.");
  const outbox = await withTransaction(async (connection) => {
    if (next) await repo.setPortfolioMember(id, userId, next, actor.id, connection);
    else await repo.removePortfolioMember(id, userId, connection);
    await recordAudit(audit(actor, "PORTFOLIO_MEMBER", id, { userId, role: next }), connection);
    return next && !current && userId !== actor.id ? insertOutbox(null, [portfolioMessages.added({ id, name: found.portfolio.name }, userId, actor.name, PROJECT_ROLE_LABEL[next])], connection) : [];
  });
  await send(outbox);
  return { ok: true, value: undefined, message: next ? (current ? "Role changed." : "Added.") : "Removed." };
}

// ---- work in the portfolio ------------------------------------------------------------------------
export async function addWork(id: number, item: { projectId?: number | null; portfolioId?: number | null }, actor: TaskActor): Promise<Result<{ itemId: number }>> {
  const found = await portfolioFor(id, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.edit) return fail(ONLY_EDITORS);
  const projectId = item.projectId ?? null;
  const childId = item.portfolioId ?? null;
  if ((projectId === null) === (childId === null)) return fail("Choose a project or a portfolio.");
  // Only what the person can see (a hidden id is "not found", never a hint).
  if (projectId !== null && !(await repo.visibleProjectIds(found.viewer, [projectId])).has(projectId)) return fail(NOT_FOUND);
  if (childId !== null && !(await repo.visiblePortfolioIds(found.viewer, [childId])).has(childId)) return fail(NOT_FOUND);
  const added = await withTransaction(async (connection) => {
    await repo.findPortfolio(id, connection, true); // one change at a time per portfolio
    if ((await repo.countItems(id, connection)) >= PORTFOLIO_LIMITS.items) return fail("This portfolio has reached its item limit.");
    if (childId !== null) {
      const problem = nestingProblem(await repo.nestingEdges(connection), id, childId);
      if (problem) return fail(NESTING_MESSAGE[problem]);
    }
    const itemId = await repo.insertItem(id, { projectId, childId }, actor.id, connection);
    if (itemId === "DUPLICATE") return fail("That item is already in this portfolio.");
    await recordAudit(audit(actor, "PORTFOLIO_ITEM_ADDED", id, { projectId, portfolioId: childId }), connection);
    return { ok: true as const, value: { itemId } };
  });
  return added.ok ? { ...added, message: "Added to the portfolio." } : added;
}

async function itemIn(id: number, itemId: number, actor: TaskActor) {
  const found = await portfolioFor(id, actor);
  if (!found) return null;
  const item = await repo.findItem(itemId);
  if (!item || item.portfolioId !== id) return null;
  return { found, item };
}
// Removing a row is allowed even when the person can't see what it is (an
// editor tidying up); the project itself is never touched.
export async function removeWork(id: number, itemId: number, actor: TaskActor): Promise<Result> {
  const hit = await itemIn(id, itemId, actor);
  if (!hit) return fail(NOT_FOUND);
  if (!hit.found.can.edit) return fail(ONLY_EDITORS);
  await withTransaction(async (connection) => {
    await repo.deleteItem(itemId, connection);
    await recordAudit(audit(actor, "PORTFOLIO_ITEM_REMOVED", id, { projectId: hit.item.projectId, portfolioId: hit.item.childId }), connection);
  });
  return { ok: true, value: undefined, message: "Removed from the portfolio. The project itself is unchanged." };
}
async function seesItem(viewer: WorkViewer, item: { projectId: number | null; childId: number | null }) {
  return item.projectId !== null ? (await repo.visibleProjectIds(viewer, [item.projectId])).has(item.projectId) : (await repo.visiblePortfolioIds(viewer, [item.childId!])).has(item.childId!);
}
export async function setPriority(id: number, itemId: number, priority: string | null, actor: TaskActor): Promise<Result> {
  const hit = await itemIn(id, itemId, actor);
  if (!hit) return fail(NOT_FOUND);
  if (!hit.found.can.edit) return fail(ONLY_EDITORS);
  if (!(await seesItem(hit.found.viewer, hit.item))) return fail(NOT_FOUND);
  if (priority !== null && !(PRIORITIES as readonly string[]).includes(priority)) return fail("Choose a priority.");
  await repo.setItemPriority(itemId, priority as (typeof PRIORITIES)[number] | null);
  return { ok: true, value: undefined, message: "Saved." };
}

// ---- own columns ----------------------------------------------------------------------------------
export async function addField(id: number, raw: unknown, actor: TaskActor): Promise<Result<{ id: number }>> {
  const found = await portfolioFor(id, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.edit) return fail(ONLY_EDITORS);
  const parsed = fieldInputSchema.safeParse(raw);
  if (!parsed.success) return firstError(parsed.error);
  const options = [...new Set(parsed.data.options)];
  if (parsed.data.kind === "SELECT" && options.length < 1) return fail("Add at least one option.", { options: "Add at least one option." });
  const fields = await repo.listFields(id);
  if (fields.length >= PORTFOLIO_LIMITS.fields) return fail(`A portfolio has at most ${PORTFOLIO_LIMITS.fields} columns of its own.`);
  if (fields.some((field) => field.name.toLowerCase() === parsed.data.name.toLowerCase()) || ["name", "status", "task progress", "due date", "owner", "priority"].includes(parsed.data.name.toLowerCase()))
    return fail("There is already a column with that name.", { name: "There is already a column with that name." });
  const fieldId = await withTransaction(async (connection) => {
    const fieldId = await repo.insertField(id, { name: parsed.data.name, kind: parsed.data.kind, options }, actor.id, connection);
    await recordAudit(audit(actor, "PORTFOLIO_FIELD_ADDED", id, { fieldId, kind: parsed.data.kind }), connection);
    return fieldId;
  });
  return { ok: true, value: { id: fieldId }, message: "Column added." };
}
export async function removeField(id: number, fieldId: number, actor: TaskActor): Promise<Result> {
  const found = await portfolioFor(id, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.edit) return fail(ONLY_EDITORS);
  if (!(await repo.listFields(id)).some((field) => field.id === fieldId)) return fail(NOT_FOUND);
  await withTransaction(async (connection) => {
    await repo.deleteField(fieldId, connection);
    await recordAudit(audit(actor, "PORTFOLIO_FIELD_REMOVED", id, { fieldId }), connection);
  });
  return { ok: true, value: undefined, message: "Column removed with its values." };
}
export async function setFieldValue(id: number, itemId: number, fieldId: number, raw: unknown, actor: TaskActor): Promise<Result> {
  const hit = await itemIn(id, itemId, actor);
  if (!hit) return fail(NOT_FOUND);
  if (!hit.found.can.edit) return fail(ONLY_EDITORS);
  if (!(await seesItem(hit.found.viewer, hit.item))) return fail(NOT_FOUND);
  const field = (await repo.listFields(id)).find((item) => item.id === fieldId);
  if (!field) return fail(NOT_FOUND);
  const people = field.kind === "PEOPLE" && /^\d{1,10}$/.test(String(raw ?? "")) ? await repo.activePeople([Number(raw)]) : new Set<number>();
  const checked = checkFieldValue(field, raw, (person) => people.has(person));
  if (!checked.ok) return fail(checked.message);
  await repo.setFieldValue(itemId, fieldId, checked.value, actor.id);
  return { ok: true, value: undefined, message: "Saved." };
}

// ---- status updates ---------------------------------------------------------------------------------
export async function postStatus(id: number, raw: unknown, actor: TaskActor): Promise<Result> {
  const found = await portfolioFor(id, actor);
  if (!found) return fail(NOT_FOUND);
  if (!found.can.edit) return fail("Only the portfolio's owners and editors can post status updates.");
  const parsed = statusInputSchema.safeParse(raw);
  if (!parsed.success) return fail("Pick a status.", { status: "Pick a status." });
  const problem = statusProblem(parsed.data);
  if (problem) return fail(problem, { title: problem });
  const status = parsed.data.status;
  const title = parsed.data.title.replace(/\s+/g, " ").trim().slice(0, 200) || STATUS_KIND_LABEL[status];
  const outbox = await withTransaction(async (connection) => {
    await repo.insertStatusUpdate(id, { status, title, body: parsed.data.body || null }, actor.id, connection);
    await repo.updatePortfolio(id, { current_status: status }, connection);
    await recordAudit(audit(actor, "PORTFOLIO_STATUS_POSTED", id, { status }), connection);
    const people = await repo.withProjectsModule(found.members.map((member) => member.id).filter((person) => person !== actor.id), connection);
    return insertOutbox(null, people.map((person) => portfolioMessages.status({ id, name: found.portfolio.name }, person, actor.name, STATUS_KIND_LABEL[status], title)), connection);
  });
  await send(outbox);
  return { ok: true, value: undefined, message: "Status update posted." };
}
export async function removeStatus(statusId: number, actor: TaskActor): Promise<Result> {
  const update = await repo.findStatusUpdate(statusId);
  if (!update) return fail(NOT_FOUND);
  const found = await portfolioFor(update.portfolioId, actor);
  if (!found) return fail(NOT_FOUND);
  if (update.authorId !== actor.id) return fail("Only its author can delete a status update.");
  await withTransaction(async (connection) => {
    await repo.deleteStatusUpdate(statusId, connection);
    await repo.updatePortfolio(update.portfolioId, { current_status: await repo.latestStatus(update.portfolioId, connection) }, connection);
  });
  return { ok: true, value: undefined, message: "Deleted." };
}

// A project was set to Off track: each live portfolio holding it tells its
// owners, if they can see that project (and aren't the one who set it).
export async function notifyProjectOffTrack(project: { id: number; name: string }, actor: TaskActor): Promise<void> {
  try {
    if ((await featureMode("pm_portfolios").catch(() => "OFF" as const)) === "OFF") return;
    const holders = await repo.portfoliosHoldingProject(project.id);
    if (!holders.length) return;
    const messages = [];
    const told = new Set<string>();
    for (const holder of holders) {
      const owners = await repo.withProjectsModule(holder.ownerIds.filter((person) => person !== actor.id));
      for (const owner of owners) {
        if (told.has(`${holder.id}:${owner}`)) continue;
        const roles = await rolesOf(owner);
        const viewer = await workViewer({ id: owner, roles, modules: ["PROJECT"] });
        if (!(await repo.visibleProjectIds(viewer, [project.id])).has(project.id)) continue;
        told.add(`${holder.id}:${owner}`);
        messages.push(portfolioMessages.offTrack({ id: holder.id, name: holder.name }, owner, project, actor.name));
      }
    }
    if (!messages.length) return;
    const ids = await insertOutbox(null, messages, getDbPool());
    await send(ids);
  } catch (error) {
    logError("portfolio off-track notice failed", error);
  }
}
async function rolesOf(userId: number): Promise<string[]> {
  const [rows] = await getDbPool().query<(import("mysql2/promise").RowDataPacket & { code: string })[]>("SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?", [userId]);
  return rows.map((row) => String(row.code));
}

// ---- what a page shows ---------------------------------------------------------------------------------
export interface PortfolioView {
  portfolio: PortfolioRecord;
  members: repo.PortfolioMember[];
  role: ProjectRole;
  can: ReturnType<typeof portfolioAbilities>;
  isMember: boolean;
  starred: boolean;
  rows: PortfolioRow[];
  hidden: number;
  fields: repo.PortfolioField[];
  totals: TaskCounts & { projects: number };
  nested: boolean;
}
// The rows (masked where the person can't see the item), with roll-ups.
export async function loadPortfolio(id: number, actor: TaskActor): Promise<PortfolioView | null> {
  const found = await portfolioFor(id, actor);
  if (!found) return null;
  const { viewer } = found;
  const [items, fields, starred, links] = await Promise.all([repo.listItems(id), repo.listFields(id), repo.isStarred(actor.id, id), repo.allItemLinks()]);
  const reach = reachable(id, links);
  const [seenProjects, seenPortfolios] = await Promise.all([repo.visibleProjectIds(viewer, reach.projects), repo.visiblePortfolioIds(viewer, reach.portfolios)]);
  const directProjects = items.map((item) => item.projectId).filter((value): value is number => value !== null && seenProjects.has(value));
  const directChildren = items.map((item) => item.childId).filter((value): value is number => value !== null && seenPortfolios.has(value));
  const [projectInfo, childInfo, counts, values] = await Promise.all([repo.projectInfo(directProjects), repo.portfolioInfo(directChildren), repo.taskCountsByProject(directProjects), repo.fieldValues(items.map((item) => item.id))]);
  const canSeeProject = (project: number) => seenProjects.has(project);
  const canSeePortfolio = (portfolio: number) => seenPortfolios.has(portfolio);
  // Sub-portfolios: their projects' figures and dates, for this person.
  const childRollups = new Map<number, { counts: TaskCounts; projects: number[] }>();
  for (const child of directChildren) {
    const projects = rolledUpProjects(child, links, canSeeProject, canSeePortfolio);
    childRollups.set(child, { counts: await repo.distinctTaskCounts(projects), projects });
  }
  const spanInfo = await repo.projectInfo([...new Set([...childRollups.values()].flatMap((entry) => entry.projects))]);
  const rows: PortfolioRow[] = items.map((item) => {
    const base = { itemId: item.id, addedByName: item.addedByName, addedAt: item.addedAt, priority: item.priority, values: values.get(item.id) ?? {} };
    if (item.projectId !== null) {
      const info = projectInfo.get(item.projectId);
      const row = info ? visibleRow({ ...base, kind: "PROJECT", info, counts: counts.get(item.projectId) ?? NO_COUNTS }) : null;
      return row ?? maskRow(placeholder(base, "PROJECT"));
    }
    const info = childInfo.get(item.childId!);
    if (!info) return maskRow(placeholder(base, "PORTFOLIO"));
    const rollup = childRollups.get(item.childId!)!;
    const span = rollup.projects.map((project) => spanInfo.get(project)).filter((value): value is ProjectInfo => Boolean(value));
    const startOn = info.startOn ?? minOf(span.map((project) => project.startOn));
    const dueOn = info.dueOn ?? maxOf(span.map((project) => project.dueOn));
    return { ...visibleRow({ ...base, kind: "PORTFOLIO", info: { ...info, startOn, dueOn }, counts: rollup.counts }), projects: rollup.projects.length };
  });
  const allProjects = rolledUpProjects(id, links, canSeeProject, canSeePortfolio);
  const totals = { ...(await repo.distinctTaskCounts(allProjects)), projects: allProjects.length };
  return {
    portfolio: found.portfolio,
    members: found.members,
    role: found.role,
    can: found.can,
    isMember: found.members.some((member) => member.id === actor.id),
    starred,
    rows,
    hidden: rows.filter((row) => row.masked).length,
    fields,
    totals,
    nested: items.some((item) => item.childId !== null),
  };
}
const minOf = (list: (string | null)[]) => list.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
const maxOf = (list: (string | null)[]) => list.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
function visibleRow(input: { itemId: number; kind: "PROJECT" | "PORTFOLIO"; info: ProjectInfo; counts: TaskCounts; addedByName: string; addedAt: string; priority: VisibleRow["priority"]; values: Record<number, string> }): VisibleRow {
  const { info } = input;
  return {
    itemId: input.itemId,
    kind: input.kind,
    masked: false,
    id: info.id,
    name: info.name,
    color: info.color,
    status: info.status,
    statusAt: info.statusAt,
    counts: input.counts,
    startOn: info.startOn,
    dueOn: info.dueOn,
    ownerId: info.ownerId,
    ownerName: info.ownerName,
    priority: input.priority,
    archived: info.archived,
    values: input.values,
    addedByName: input.addedByName,
    addedAt: input.addedAt,
  };
}
// Only what maskRow keeps is real; the rest never leaves the server.
function placeholder(base: { itemId: number; addedByName: string; addedAt: string }, kind: "PROJECT" | "PORTFOLIO"): VisibleRow {
  return { ...base, kind, masked: false, id: 0, name: "", color: "gray", status: null, statusAt: null, counts: NO_COUNTS, startOn: null, dueOn: null, ownerId: 0, ownerName: "", priority: null, archived: false, values: {} };
}
// Every project and portfolio below `id` (any level), to ask once what the person sees.
function reachable(id: number, links: readonly ItemLink[]): { projects: number[]; portfolios: number[] } {
  const projects = new Set<number>();
  const portfolios = new Set<number>();
  const stack = [id];
  const seen = new Set<number>();
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const link of links) {
      if (link.portfolioId !== next) continue;
      if (link.projectId !== null) projects.add(link.projectId);
      if (link.childId !== null) {
        portfolios.add(link.childId);
        stack.push(link.childId);
      }
    }
  }
  return { projects: [...projects], portfolios: [...portfolios] };
}

// ---- Progress and Dashboard -----------------------------------------------------------------------------
export async function loadStatusUpdates(id: number, actor: TaskActor) {
  const found = await portfolioFor(id, actor);
  return found ? repo.listStatusUpdates(id) : [];
}
export interface PortfolioWidget {
  key: string;
  title: string;
  size: "QUARTER" | "HALF";
  note: string;
  data: ChartData;
}
const numberChart = (total: number): ChartData => ({ style: "number", categories: [], series: [], values: [], formats: [{ kind: "count" }], total, benchmark: null, dataLabels: true, percent: false, xLabel: "", yLabel: "", note: null, empty: false });
// The default dashboard (spec §3.18) over the projects the person can see,
// each task once; built with the project dashboard's chart code (D-375).
export async function loadDashboard(view: PortfolioView, actor: TaskActor, now = new Date()): Promise<PortfolioWidget[]> {
  const found = await portfolioFor(view.portfolio.id, actor);
  if (!found) return [];
  const links = await repo.allItemLinks();
  const reach = reachable(view.portfolio.id, links);
  const [seenProjects, seenPortfolios] = await Promise.all([repo.visibleProjectIds(found.viewer, reach.projects), repo.visiblePortfolioIds(found.viewer, reach.portfolios)]);
  const projects = rolledUpProjects(view.portfolio.id, links, (p) => seenProjects.has(p), (p) => seenPortfolios.has(p));
  const [totals, info, perProject, days] = await Promise.all([repo.distinctTaskCounts(projects), repo.projectInfo(projects), repo.taskCountsByProject(projects), repo.taskDays(projects)]);
  const ordered = projects.map((project) => info.get(project)).filter((value): value is ProjectInfo => Boolean(value)).sort((a, b) => a.name.localeCompare(b.name));
  const statusNatural = STATUS_KINDS.map((kind) => ({ key: kind, label: STATUS_KIND_LABEL[kind] }));
  const donut = (rows: GroupRow[], label: string) =>
    assembleChart({ config: chartConfigSchema.parse({ style: "donut", x: { by: "completion" } }), rows, x: { natural: statusNatural, none: "No recent updates", fill: false, label: "Status" }, series: null, metricLabels: [label], formats: [{ kind: "count" }] });
  const byStatus = (statuses: (ProjectStatusKind | null)[]): GroupRow[] => {
    const map = new Map<string | null, number>();
    for (const status of statuses) map.set(status, (map.get(status) ?? 0) + 1);
    return [...map.entries()].map(([k, tasks]) => ({ k, s: null, tasks, sums: [], counts: [] }));
  };
  const incomplete = assembleChart({
    config: chartConfigSchema.parse({ style: "bar", x: { by: "section" } }),
    rows: ordered.map((project) => ({ k: String(project.id), s: null, tasks: (perProject.get(project.id)?.total ?? 0) - (perProject.get(project.id)?.completed ?? 0), sums: [], counts: [] })),
    x: { natural: ordered.map((project) => ({ key: String(project.id), label: project.name })), none: "None", fill: false, label: "Project" },
    series: null,
    metricLabels: ["Incomplete tasks"],
    formats: [{ kind: "count" }],
  });
  const today = indiaDay(now);
  const range = rangeDays("30d", today, { startOn: null, dueOn: null, createdOn: today });
  const burn = burnChart(chartConfigSchema.parse({ style: "burnup" }), days.map((item) => ({ created: item.created, completed: item.completed, n: 1 })), timeBuckets(range.from, range.to, "day").buckets);
  const widgets: PortfolioWidget[] = [
    { key: "total", title: "Total tasks", size: "QUARTER", note: "No filters", data: numberChart(totals.total) },
    { key: "done", title: "Total completed tasks", size: "QUARTER", note: "Completed", data: numberChart(totals.completed) },
    { key: "open", title: "Total incomplete tasks", size: "QUARTER", note: "Incomplete", data: numberChart(totals.total - totals.completed) },
    { key: "late", title: "Total overdue tasks", size: "QUARTER", note: "Overdue", data: numberChart(totals.overdue) },
    { key: "status", title: "Projects by project status", size: "HALF", note: "Latest status update", data: donut(byStatus(ordered.map((project) => project.status)), "Projects") },
    { key: "incomplete", title: "Incomplete tasks by project", size: "HALF", note: "Incomplete", data: incomplete },
    { key: "burnup", title: "Task completion over time", size: "HALF", note: "Last 30 days", data: burn },
  ];
  const subPortfolios = [...seenPortfolios];
  if (subPortfolios.length) {
    const children = await repo.portfolioInfo(subPortfolios);
    widgets.push({ key: "portfolios", title: "Portfolios by portfolio status", size: "HALF", note: "Every level", data: donut(byStatus([...children.values()].map((child) => child.status)), "Portfolios") });
  }
  return widgets;
}

// Projects and portfolios the person may add (Add work, the wizard): visible, not deleted.
export async function workChoices(actor: TaskActor, q = "") {
  if (!(await portfoliosOn(actor))) return { projects: [], portfolios: [] };
  const viewer = await workViewer(actor);
  if (viewer.projects === false) return { projects: [], portfolios: [] };
  return repo.workCandidates(viewer, q, 500);
}
