import { addDays, RECENT_DAYS } from "@/server/work/rules";

// v1.54.4 (owner, D-313): Task Summary's own sections, by date: Overdue, Due
// today, Due in the next 7 days, Completed today.
// v1.63.0 (D-369, PM-A13, with "pm_foundations" on): a "Recently assigned"
// section after Overdue (D-225 keeps Overdue first): open tasks someone else
// gave the person in the last 3 days (RECENT_DAYS), whatever their due date,
// so new work is seen at once. An overdue task stays in Overdue.
export interface SummarySection {
  id: number;
  name: string;
  system: string;
}
export const SUMMARY_IDS = { overdue: -1, today: -2, week: -3, done: -4, recent: -5, later: -6 } as const;

// v1.76.0 (D-401): a tab showing "All my open tasks" adds "Due later" (after
// the next 7 days) before Completed today.
export function summarySections(recentOn: boolean, allOpen = false): SummarySection[] {
  return [
    { id: SUMMARY_IDS.overdue, name: "Overdue", system: "SUMMARY" },
    ...(recentOn ? [{ id: SUMMARY_IDS.recent, name: "Recently assigned", system: "SUMMARY" }] : []),
    { id: SUMMARY_IDS.today, name: "Due today", system: "SUMMARY" },
    { id: SUMMARY_IDS.week, name: "Due in the next 7 days", system: "SUMMARY" },
    ...(allOpen ? [{ id: SUMMARY_IDS.later, name: "Due later", system: "SUMMARY" }] : []),
    { id: SUMMARY_IDS.done, name: "Completed today", system: "SUMMARY" },
  ];
}

export const isRecentlyAssigned = (task: { assignedAt: Date | null; selfAssigned: boolean }, now: Date) =>
  !task.selfAssigned && task.assignedAt !== null && now.getTime() - task.assignedAt.getTime() < RECENT_DAYS * 86_400_000 && task.assignedAt.getTime() <= now.getTime() + 60_000;

// The section of one task; `dueDay` is its India day (null: no due date).
export function summarySection(task: { status: string; dueDay: string | null; assignedAt: Date | null; selfAssigned: boolean }, today: string, now: Date, recentOn: boolean, allOpen = false): number {
  if (task.status === "COMPLETED") return SUMMARY_IDS.done;
  const day = task.dueDay ?? today;
  if (day < today) return SUMMARY_IDS.overdue;
  if (recentOn && isRecentlyAssigned(task, now)) return SUMMARY_IDS.recent;
  if (day === today) return SUMMARY_IDS.today;
  if (day <= addDays(today, 7)) return SUMMARY_IDS.week;
  // v1.76.0 (D-401): with "All my open tasks", later tasks are Due later.
  if (allOpen) return SUMMARY_IDS.later;
  // Only a recently assigned task gets here (the summary lists nothing later).
  return recentOn ? SUMMARY_IDS.recent : SUMMARY_IDS.week;
}
