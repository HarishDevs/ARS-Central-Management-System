import "server-only";
import { listTaskItems, ensureMySections, listMySectionsOnly, myPlacements, visibleTaskClause, type MySection, type WorkTaskItem } from "@/lib/db/repositories/work.repository";
import type { WorkViewer } from "@/server/work/access";
import { readOnlyRow } from "@/server/work/summary-views";
import { toGridTask } from "@/server/work/grid-rows";
import type { GridTask } from "@/server/work/grid";
import { summarySection, summarySections, type SummarySection } from "@/server/work/my-summary";
import { mySectionOf, rangeLimit, rangeWhere, type TabRange } from "@/server/work/my-sections";
import { indiaDay } from "@/server/work/rules";

// v1.76.0 (D-401): one loader for Task Summary's rows, used by the page and the
// CSV download, so both list exactly the same tasks. Only the signed-in
// person's own tasks (assignee = them) and only their own sections: a person
// never sees anyone else's sections or order (R1; sharing comes later and
// will still only show tasks the viewer may see).
export interface SummaryData {
  items: WorkTaskItem[];
  rows: GridTask[];
  dateSections: SummarySection[];
  mySections: MySection[] | null;
  today: string;
}

// v1.77.0 (D-404): `viewer` = someone else opening this person's Task Summary
// (a manager above them, or a person it is shared with): only the tasks the
// viewer may see themselves are listed (the rest are left out, never masked),
// every row is read-only, and the owner's sections are read without creating any.
export async function loadTaskSummary(userId: number, input: { range: TabRange; recentOn: boolean; mine: boolean; now?: Date; viewer?: WorkViewer }): Promise<SummaryData> {
  const now = input.now ?? new Date();
  const today = indiaDay(now);
  const weekEnd = indiaDay(new Date(now.getTime() + 7 * 86_400_000));
  const todayStart = new Date(`${today}T00:00:00+05:30`);
  const recentSince = new Date(now.getTime() - 3 * 86_400_000);
  const range = rangeWhere(input.range, input.recentOn);
  const values = { weekEnd, todayStart, recentSince };
  const other = input.viewer && input.viewer.id !== userId ? input.viewer : null;
  const seen = other ? visibleTaskClause(other) : null;
  const list = await listTaskItems(
    ["t.assignee_id = ?", "t.deleted_at IS NULL", range.sql, ...(seen ? [seen.sql] : [])],
    [userId, ...range.uses.map((key) => values[key]), ...(seen ? seen.params : [])],
    "t.due_at IS NULL, t.due_at, t.id",
    rangeLimit(input.range),
  );
  const sectionsOf = other ? listMySectionsOnly(userId).then((sections) => (sections.length ? sections : null)) : ensureMySections(userId);
  const [mySections, placements] = input.mine ? await Promise.all([sectionsOf, myPlacements(userId)]) : [null, null];
  const allOpen = input.range === "all";
  const rows = list.items.map((task) => {
    const dueDay = task.dueAt ? indiaDay(task.dueAt) : null;
    const sectionId = summarySection({ status: task.status, dueDay, assignedAt: task.assignedAt, selfAssigned: task.createdBy === userId }, today, now, input.recentOn, allOpen);
    const position = task.dueAt ? task.dueAt.getTime() / 1000 : 9e9;
    const base = toGridTask(task, userId, true, sectionId, position);
    const row = other ? readOnlyRow(base) : base;
    if (mySections && placements) {
      const placement = placements.get(task.id) ?? null;
      row.mySectionId = mySectionOf({ open: ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(task.status), dueDay }, placement, mySections, today);
      // Never placed: newest assignment first in Recently assigned.
      row.myPosition = placement && placement.sectionId === row.mySectionId ? placement.position : -(task.assignedAt?.getTime() ?? task.createdAt.getTime()) / 1000;
    }
    return row;
  });
  return { items: list.items, rows, dateSections: summarySections(input.recentOn, allOpen), mySections, today };
}
