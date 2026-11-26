import "server-only";
import { hasModule } from "@/server/modules/modules";
import type { ModuleCode } from "@/types/auth";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import { personFacts } from "@/lib/db/repositories/tasks.repository";
import { getManagerMap } from "@/lib/db/repositories/admin-users.repository";
import { teamBelow } from "@/server/work/hierarchy";
import { isFollowing, projectFacts, projectsGoverning } from "@/lib/db/repositories/work.repository";
import { commenterRights, effectiveProjectRole, higher, taskRights, type ProjectRole, type TaskRights, type WorkViewer } from "@/server/work/access";
import type { TaskViewer } from "@/server/modules/task-rules";

// D-215: one place that works out how a person is connected to a task
// (party, follower, projects of the task and of its top task) and so what
// they may do. Used by the task page, task actions and every work action.
export const isAdminRoles = (roles: readonly string[]) => roles.includes("IT_ADMIN") || roles.includes("SUPER_ADMIN");

export async function workViewer(actor: { id: number; roles: readonly string[]; modules?: readonly ModuleCode[] }, db: Queryable = getDbPool()): Promise<WorkViewer> {
  const me = await personFacts(actor.id, db);
  // D-308: without the Projects module, projects grant nothing (modules unknown = as before).
  const projects = !actor.modules || hasModule({ roles: actor.roles, modules: actor.modules }, "PROJECT");
  // v1.91.0 (D-434): known not to have the Task module (modules unknown = as before).
  const withoutTaskModule = Boolean(actor.modules) && !hasModule({ roles: actor.roles, modules: actor.modules ?? [] }, "TASK");
  return { id: actor.id, departmentId: me?.departmentId ?? null, isAdmin: isAdminRoles(actor.roles), teamIds: await teamOf(actor.id, db), projects, ...(withoutTaskModule ? { withoutTaskModule } : {}) };
}

// D-216: everyone below the person in the reporting chain (all levels).
export async function teamOf(managerId: number, db: Queryable = getDbPool()): Promise<number[]> {
  return teamBelow(await getManagerMap(db), managerId);
}

interface TaskShape {
  id: number;
  rootTaskId: number | null;
  createdBy: number;
  assigneeId: number;
  assignedBy: number;
  assigneeManagerId: number | null;
}

export async function rightsOn(task: TaskShape, viewer: WorkViewer, db: Queryable = getDbPool()): Promise<TaskRights & { bestRole: ProjectRole | null; adhoc: boolean; commenter?: boolean }> {
  // v1.91.0 (D-434, owner: "if I am added as a collaborator I should be able to
  // open and access that approval" / "in this case I am a commenter"): without
  // the Task module, a task the person is not a party to (v1.50.1 keeps the
  // parties' rights) opens only if they were added to THAT task as a
  // collaborator (not through its top task, a project or the reporting line),
  // and then only to view, comment and like. Removing them revokes it at once.
  if (viewer.withoutTaskModule && !viewer.isAdmin && task.assigneeId !== viewer.id && task.createdBy !== viewer.id && task.assignedBy !== viewer.id) {
    const direct = await isFollowing([task.id], viewer.id, db);
    const none = taskRights({ isAssignee: false, isCreator: false, isFollower: false, managesAssignee: false, isAdmin: false, bestProjectRole: null, adhoc: true, isOriginalCreator: false });
    return { ...commenterRights(none, direct), bestRole: null, adhoc: true, commenter: direct };
  }
  let best: ProjectRole | null = null;
  for (const { project, members } of await projectsGoverning(task.id, task.rootTaskId, db)) best = higher(best, effectiveProjectRole(projectFacts(project, members), viewer));
  // The top task's people see its subtasks too.
  let rootParty = false;
  if (task.rootTaskId) {
    const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM tasks WHERE id = ? AND (assignee_id = ? OR created_by = ? OR assigned_by = ?)", [task.rootTaskId, viewer.id, viewer.id, viewer.id]);
    rootParty = rows.length > 0;
  }
  const follower = await isFollowing([task.id, task.rootTaskId ?? task.id], viewer.id, db);
  // D-222: ad hoc = not repeating and not part of a repeating series.
  // v1.66.0 (D-374): nor made from a project form (its creator is the system
  // user, so it is the project's to edit, like a periodic task).
  const [kind] = await db.query<RowDataPacket[]>("SELECT recurrence_json IS NULL AND series_id IS NULL AND source_form_id IS NULL AS adhoc FROM tasks WHERE id = ?", [task.id]);
  const adhoc = Boolean(kind[0]?.adhoc);
  const rights = taskRights({
    isAssignee: task.assigneeId === viewer.id,
    isCreator: task.createdBy === viewer.id || task.assignedBy === viewer.id,
    isFollower: follower || rootParty,
    managesAssignee: task.assigneeManagerId === viewer.id || viewer.teamIds.includes(task.assigneeId),
    isAdmin: viewer.isAdmin,
    bestProjectRole: best,
    adhoc,
    isOriginalCreator: task.createdBy === viewer.id,
  });
  return { ...rights, bestRole: best, adhoc };
}

// The task rules' viewer, with what projects and followers add.
export async function taskViewerFor(task: TaskShape, actor: { id: number; roles: readonly string[] }, db: Queryable = getDbPool()): Promise<TaskViewer> {
  const viewer = await workViewer(actor, db);
  const rights = await rightsOn(task, viewer, db);
  return {
    id: actor.id,
    isAdmin: viewer.isAdmin,
    managesAssignee: task.assigneeManagerId === actor.id || viewer.teamIds.includes(task.assigneeId),
    workSee: rights.view,
    workEdit: rights.bestRole === "OWNER" || rights.bestRole === "EDITOR",
    workComment: rights.comment,
    // D-222: an ad hoc task is edited, reassigned, cancelled and reopened by its creator (and IT) only.
    creatorOnly: rights.adhoc,
    teamIds: viewer.teamIds,
    // v1.91.0 (D-434): a collaborator without the Task module: view and comment only.
    ...(rights.commenter ? { commenter: true } : {}),
  };
}
