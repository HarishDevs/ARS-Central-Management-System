import { z } from "zod";
import { addDays } from "@/server/work/schedule";
import { assembleChart, chartConfigSchema, DUE_STATUS_LABEL, dueStatusOf, timeBuckets, type ChartData, type DueStatus, type GroupRow, type KeyLabel } from "@/server/work/reporting";
import type { SummaryAccess } from "@/server/work/summary-views";

// v1.78.0 (D-405, Task Summary release 3 "extra tabs and reach"). Pure and
// unit-tested; server/work/summary-extras.ts runs the SQL and the checks.
//
// 1. Dashboard tab: the person's own task charts, worked out from the tasks
//    given to them that the viewer may see (someone else's: omitted, never
//    masked, exactly like the list).
// 2. Notes tab: one private rich-text note per person. Only its owner reads
//    or writes it, so a manager or a person it is shared with sees a notice.
// 3. Files tab: who sees which files is the list's rule (handled in SQL).
// 4. Request access (spec §5.3, BR-MYT-017 adapted): someone refused a Task
//    Summary asks its owner; the owner grants (a read-only share, as Invite)
//    or declines.
// 5. The profile's Tasks card (spec §3.17).

// ---- dashboard -----------------------------------------------------------------------------
export const DASHBOARD_RANGES = ["14d", "30d", "90d"] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DASHBOARD_RANGE_LABEL: Record<DashboardRange, string> = { "14d": "Last 14 days", "30d": "Last 30 days", "90d": "Last 90 days" };
export const parseDashboardRange = (value: unknown): DashboardRange => ((DASHBOARD_RANGES as readonly unknown[]).includes(value) ? (value as DashboardRange) : "30d");
export const rangeLength = (range: DashboardRange) => (range === "14d" ? 14 : range === "90d" ? 90 : 30);

export type SummaryPriority = "LOW" | "NORMAL" | "ELEVATED" | "IMPORTANT" | "HIGH" | "URGENT";
const PRIORITY_ORDER: readonly SummaryPriority[] = ["URGENT", "HIGH", "IMPORTANT", "ELEVATED", "NORMAL", "LOW"];
const PRIORITY_LABEL: Record<SummaryPriority, string> = { URGENT: "Critical", HIGH: "Most Important", IMPORTANT: "Important", ELEVATED: "High", NORMAL: "Normal", LOW: "Low" };

export interface DashboardTask {
  id: number;
  open: boolean; // OPEN, IN_PROGRESS or BLOCKED
  done: boolean; // COMPLETED
  dueDay: string | null; // India day
  completedDay: string | null; // India day
  priority: SummaryPriority;
  projects: string[]; // names
}
export interface DashboardNumber {
  key: "open" | "overdue" | "today" | "done";
  label: string;
  value: number;
}
export interface DashboardChart {
  key: "due" | "completed" | "completion" | "project" | "priority";
  title: string;
  data: ChartData;
}
export interface SummaryDashboardView {
  range: DashboardRange;
  numbers: DashboardNumber[];
  charts: DashboardChart[];
}

const COUNT = [{ kind: "count" as const }];
const chart = (style: "bar" | "donut", rows: GroupRow[], natural: KeyLabel[], label: string, none = "None", fill = false, dataLabels = true): ChartData =>
  assembleChart({
    config: chartConfigSchema.parse({ style, x: { by: "dueStatus" }, dataLabels }),
    rows,
    x: { natural, none, fill, label },
    series: null,
    metricLabels: ["Tasks"],
    formats: COUNT,
  });
const grouped = (keys: readonly (string | null)[]): GroupRow[] => {
  const counts = new Map<string | null, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()].map(([k, tasks]) => ({ k, s: null, tasks, sums: [], counts: [] }));
};

// The Dashboard tab's figures. Open work is counted whatever its due date;
// "Completed" counts tasks completed within the range (India days).
export function summaryDashboard(tasks: readonly DashboardTask[], today: string, range: DashboardRange): SummaryDashboardView {
  const from = addDays(today, -(rangeLength(range) - 1));
  const open = tasks.filter((task) => task.open);
  const doneInRange = tasks.filter((task) => task.done && task.completedDay !== null && task.completedDay >= from && task.completedDay <= today);
  const status = (task: DashboardTask): DueStatus => dueStatusOf(task.dueDay, today, false);
  const numbers: DashboardNumber[] = [
    { key: "open", label: "Open tasks", value: open.length },
    { key: "overdue", label: "Overdue", value: open.filter((task) => status(task) === "overdue").length },
    { key: "today", label: "Due today", value: open.filter((task) => status(task) === "today").length },
    { key: "done", label: `Completed, ${DASHBOARD_RANGE_LABEL[range].toLowerCase()}`, value: doneInRange.length },
  ];
  const dueNatural: KeyLabel[] = (["overdue", "today", "week", "later", "none"] as const).map((key) => ({ key, label: DUE_STATUS_LABEL[key] }));
  const unit = range === "90d" ? "week" : "day";
  const { buckets } = timeBuckets(from, today, unit);
  const bucketOfDay = (day: string) => buckets.find((bucket) => day >= bucket.start && day <= bucket.end)?.key ?? null;
  const charts: DashboardChart[] = [
    { key: "due", title: "Open tasks by due date", data: chart("bar", grouped(open.map(status)), dueNatural, "Due date") },
    {
      key: "completed",
      title: unit === "week" ? "Tasks completed each week" : "Tasks completed each day",
      data: chart("bar", grouped(doneInRange.map((task) => bucketOfDay(task.completedDay!)).filter((key): key is string => key !== null)), buckets.map((bucket) => ({ key: bucket.key, label: bucket.label })), unit === "week" ? "Week" : "Day", "None", true, false),
    },
    {
      key: "completion",
      title: "Open and completed",
      data: chart("donut", grouped([...open.map(() => "open"), ...doneInRange.map(() => "done")]), [{ key: "open", label: "Open" }, { key: "done", label: `Completed, ${DASHBOARD_RANGE_LABEL[range].toLowerCase()}` }], "Status"),
    },
    { key: "project", title: "Open tasks by project", data: chart("bar", grouped(open.flatMap((task) => (task.projects.length ? task.projects : [null]))), [], "Project", "No project") },
    { key: "priority", title: "Open tasks by priority", data: chart("bar", grouped(open.map((task) => task.priority)), PRIORITY_ORDER.map((key) => ({ key, label: PRIORITY_LABEL[key] })), "Priority") },
  ];
  return { range, numbers, charts };
}

// ---- notes ---------------------------------------------------------------------------------
export const NOTES_MAX = 50_000;
export const notesInputSchema = z.object({ body: z.string().max(NOTES_MAX * 2), rowVersion: z.number().int().min(0).max(1e9) });
// Control characters out (tabs and new lines kept), Windows line ends folded, at most NOTES_MAX.
export function cleanNotes(raw: string): string | null {
  const body = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n/g, "\n");
  return body.length > NOTES_MAX ? null : body;
}
// Only the owner ever reads or writes their notes (managers and shared viewers included: private).
export const mayReadNotes = (access: SummaryAccess) => access === "OWN";

// ---- request access ------------------------------------------------------------------------
export const REQUEST_NOTE_MAX = 300;
export const accessRequestSchema = z.object({ ownerId: z.number().int().positive().max(1e10), note: z.string().max(REQUEST_NOTE_MAX * 2).default("") });
export const answerRequestSchema = z.object({ requesterId: z.number().int().positive().max(1e10), decision: z.enum(["grant", "decline"]) });
export const cleanRequestNote = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, REQUEST_NOTE_MAX);
// Why a request can't be sent, or null. Only someone refused today may ask.
// (Asking again while a request is open is a no-op: no second notice.)
export function requestProblem(input: { requesterId: number; ownerId: number; ownerActive: boolean | null; access: SummaryAccess }): string | null {
  if (input.ownerId === input.requesterId) return "That's your own Task Summary.";
  if (input.ownerActive === null) return "Not found.";
  if (!input.ownerActive) return "That person's account is inactive.";
  if (input.access) return "You can already open it.";
  return null;
}

// ---- profile Tasks card (spec §3.17) -------------------------------------------------------
export const PROFILE_CARD_MAX = 5;
export interface CardTask {
  id: number;
  taskNo: string;
  title: string;
  dueAt: string | null; // ISO
}
// The open tasks shown on the card: soonest due first (overdue on top), then by number.
export function profileCardTasks<T extends CardTask>(tasks: readonly T[], max = PROFILE_CARD_MAX): T[] {
  return [...tasks].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || a.id - b.id).slice(0, max);
}
