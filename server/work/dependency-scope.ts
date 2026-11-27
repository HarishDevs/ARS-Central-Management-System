import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { featureOn } from "@/server/settings/features";
import type { TaskActor } from "@/server/modules/tasks";

// v1.93.0 (D-449, owner 27 Nov 2026: "all dependencies based task should show
// based on portfolio or project"; supersedes spec BR-PROJ-041 "across every
// project the person can see"). Which tasks a task's dependency may point to:
// - a task in a project (its own links, or its top task's for a subtask): tasks
//   of the same project(s) first; widened, every project of the portfolio(s)
//   holding those projects (nested portfolios below them too) while the
//   "pm_portfolios" switch is on;
// - a task in no project: only the person's own tasks (assigned to or made by
//   them) that are in no project either.
// Task visibility (visibleTaskClause) still applies on top. The server checks
// this when a new link is made; links made before stay valid and shown.
// The refusal when a new link points outside the scope.
export const OUT_OF_SCOPE = "Choose a task in the same project or portfolio (for a task in no project: one of your own tasks in no project).";
export type ScopeKind = "PROJECT" | "OWN";
export interface DependencyScope {
  kind: ScopeKind;
  projectIds: number[];
  // The projects of the portfolio(s), the task's own included; null when there
  // is nothing wider (switch off, or its projects are in no portfolio).
  portfolioProjectIds: number[] | null;
}

const num = (value: unknown) => Number(value);
const MAX_DEPTH = 10;
// A task's project links: its own, or (a subtask) its top task's, as task visibility reads them.
const LINKS_OF = "sp.task_id IN (t.id, COALESCE(t.root_task_id, t.id))";

export async function dependencyScope(taskId: number | null, actor: TaskActor, db: Queryable = getDbPool()): Promise<DependencyScope> {
  if (!taskId) return { kind: "OWN", projectIds: [], portfolioProjectIds: null };
  const [own] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT sp.project_id FROM tasks t JOIN task_projects sp ON ${LINKS_OF} JOIN projects p ON p.id = sp.project_id AND p.deleted_at IS NULL WHERE t.id = ? ORDER BY sp.project_id`,
    [taskId],
  );
  const projectIds = own.map((row) => num(row.project_id));
  if (!projectIds.length) return { kind: "OWN", projectIds: [], portfolioProjectIds: null };
  if (!(await featureOn("pm_portfolios", actor).catch(() => false))) return { kind: "PROJECT", projectIds, portfolioProjectIds: null };
  const live = "pf.deleted_at IS NULL AND pf.archived_at IS NULL";
  const [direct] = await db.query<RowDataPacket[]>(`SELECT DISTINCT pi.portfolio_id FROM portfolio_items pi JOIN portfolios pf ON pf.id = pi.portfolio_id AND ${live} WHERE pi.project_id IN (?)`, [projectIds]);
  const portfolios = new Set(direct.map((row) => num(row.portfolio_id)));
  if (!portfolios.size) return { kind: "PROJECT", projectIds, portfolioProjectIds: null };
  // Nested portfolios below them (a loop or very deep nesting stops at MAX_DEPTH).
  let frontier = [...portfolios];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth += 1) {
    const [children] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT pi.child_portfolio_id FROM portfolio_items pi JOIN portfolios pf ON pf.id = pi.child_portfolio_id AND ${live} WHERE pi.portfolio_id IN (?) AND pi.child_portfolio_id IS NOT NULL`,
      [frontier],
    );
    frontier = children.map((row) => num(row.child_portfolio_id)).filter((id) => !portfolios.has(id));
    for (const id of frontier) portfolios.add(id);
  }
  const [inside] = await db.query<RowDataPacket[]>(
    "SELECT DISTINCT pi.project_id FROM portfolio_items pi JOIN projects p ON p.id = pi.project_id AND p.deleted_at IS NULL WHERE pi.portfolio_id IN (?) AND pi.project_id IS NOT NULL",
    [[...portfolios]],
  );
  const wide = [...new Set([...projectIds, ...inside.map((row) => num(row.project_id))])].sort((a, b) => a - b);
  return { kind: "PROJECT", projectIds, portfolioProjectIds: wide.length > projectIds.length ? wide : null };
}

// The SQL (on tasks `t`) for "inside the scope"; `wide` uses the portfolio's projects when there are any.
export function scopeClause(scope: DependencyScope, wide: boolean, actorId: number): { sql: string; params: unknown[] } {
  if (scope.kind === "OWN")
    return {
      sql: `NOT EXISTS (SELECT 1 FROM task_projects sp JOIN projects spp ON spp.id = sp.project_id AND spp.deleted_at IS NULL WHERE ${LINKS_OF}) AND (t.assignee_id = ? OR t.created_by = ?)`,
      params: [actorId, actorId],
    };
  const ids = wide && scope.portfolioProjectIds ? scope.portfolioProjectIds : scope.projectIds;
  return { sql: `EXISTS (SELECT 1 FROM task_projects sp WHERE ${LINKS_OF} AND sp.project_id IN (?))`, params: [ids] };
}

// Is `otherId` inside `taskId`'s widest scope? (The check behind adding a link.)
export async function inDependencyScope(taskId: number, otherId: number, actor: TaskActor, db: Queryable = getDbPool()): Promise<boolean> {
  const scope = await dependencyScope(taskId, actor, db);
  const clause = scopeClause(scope, true, actor.id);
  const [rows] = await db.query<RowDataPacket[]>(`SELECT 1 FROM tasks t WHERE t.id = ? AND t.deleted_at IS NULL AND ${clause.sql} LIMIT 1`, [otherId, ...clause.params]);
  return rows.length > 0;
}

// What the picker says about the list it shows.
export function scopeNote(scope: DependencyScope, wide: boolean): string {
  if (scope.kind === "OWN") return "Your own tasks that aren't in a project (this task isn't in one).";
  if (wide && scope.portfolioProjectIds) return "Tasks in this task's portfolio.";
  return scope.projectIds.length > 1 ? "Tasks in this task's projects." : "Tasks in this task's project.";
}
