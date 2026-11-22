import "server-only";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { childrenOf, purgeProject, purgeProjectCandidates, purgeTaskCandidates, purgeTasks, storedFileInUse } from "@/lib/db/repositories/pm.repository";
import { loadSetting } from "@/server/work/holiday-store";
import { featureMode } from "@/server/settings/features";
import { uploadRoot } from "@/server/attachments/service";
import { logError } from "@/lib/logging/logger";
import { purgeDeletedFields } from "@/lib/db/repositories/fields.repository";
import { parsePmExtras, PM_EXTRAS_KEY, PURGE_DAYS, purgeableTasks } from "@/server/work/pm-rules";

// v1.62.0 (D-368, BR-DEL-001/002): tasks and projects in Deleted for more
// than 30 days are removed for good by the job runner. Runs only while the
// "pm_foundations" switch is not Off and Admin → Task settings has the purge
// on (default on). Each batch is one transaction with one audit entry.
const TASK_BATCH = 500;
const PROJECT_BATCH = 50;

export async function runWorkPurge(options: { force?: boolean } = {}): Promise<{ purgedTasks: number; purgedProjects: number; purgedFields?: number; skipped?: string }> {
  if (!options.force) {
    if ((await featureMode("pm_foundations")) === "OFF") return { purgedTasks: 0, purgedProjects: 0, skipped: "switch off" };
    if (!parsePmExtras(await loadSetting(PM_EXTRAS_KEY)).purge) return { purgedTasks: 0, purgedProjects: 0, skipped: "purge off" };
  }
  // Tasks: one batch per run (the next run carries on).
  const candidates = await purgeTaskCandidates(TASK_BATCH);
  const order = purgeableTasks(candidates, await childrenOf(candidates.map((task) => task.id)));
  let purgedTasks = 0;
  let files: string[] = [];
  if (order.length) {
    const result = await withTransaction(async (connection) => {
      const done = await purgeTasks(order, connection);
      await recordAudit({ actorUserId: null, action: "WORK_TASKS_PURGED", entityType: "RETENTION", entityId: "tasks", metadata: { olderThanDays: PURGE_DAYS, count: done.tasks, taskIds: order.slice(0, 200), files: done.files.length } }, connection);
      return done;
    });
    purgedTasks = result.tasks;
    files = result.files;
  }
  // Projects.
  const projects = await purgeProjectCandidates(PROJECT_BATCH);
  let purgedProjects = 0;
  if (projects.length) {
    purgedProjects = await withTransaction(async (connection) => {
      let count = 0;
      for (const id of projects) count += await purgeProject(id, connection);
      await recordAudit({ actorUserId: null, action: "WORK_PROJECTS_PURGED", entityType: "RETENTION", entityId: "projects", metadata: { olderThanDays: PURGE_DAYS, count, projectIds: projects } }, connection);
      return count;
    });
  }
  // v1.64.0 (D-371, BR-CF-004): custom fields deleted more than 30 days ago, with their values.
  const purgedFields = await withTransaction(async (connection) => {
    const ids = await purgeDeletedFields(PROJECT_BATCH, connection);
    if (ids.length) await recordAudit({ actorUserId: null, action: "WORK_FIELDS_PURGED", entityType: "RETENTION", entityId: "fields", metadata: { olderThanDays: PURGE_DAYS, count: ids.length, fieldIds: ids } }, connection);
    return ids.length;
  });
  // The task files go from disk only after the rows are gone for good.
  const root = uploadRoot();
  for (const stored of files) {
    const absolute = path.resolve(root, stored);
    if (!absolute.startsWith(root + path.sep)) continue;
    // Only a file no other record still points at.
    if (await storedFileInUse(stored)) continue;
    await unlink(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") logError("work purge: couldn't remove a file", error);
    });
  }
  return { purgedTasks, purgedProjects, purgedFields };
}
