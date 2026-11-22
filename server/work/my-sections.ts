import { z } from "zod";
import { addDays } from "@/server/work/rules";
import { workingDaysBetween } from "@/server/work/working-days";
import type { WorkCalendar } from "@/server/work/schedule";

// v1.76.0 (D-401, owner): Task Summary, release 1. Pure and unit-tested.
//
// 1. Range per tab: "Summary window" (overdue, due today, due in the next 7
//    days and completed today: D-312, the default) or "All my open tasks"
//    (every open task given to me, whatever its due date, and what I
//    completed today).
// 2. "My sections" as an optional grouping per tab: Recently assigned, Today,
//    Upcoming, Later and the person's own sections (the D-215 tables). A task
//    the person never placed is in Recently assigned (new and reassigned work
//    lands there and stays until moved); an open task past its due day shows
//    in Overdue whatever its section (D-225). Rules move tasks once a night
//    (00:00 India time, the job runner).
export const TAB_RANGES = ["summary", "all"] as const;
export type TabRange = (typeof TAB_RANGES)[number];
export const TAB_RANGE_LABEL: Record<TabRange, string> = { summary: "Summary window", all: "All my open tasks" };
export const TAB_RANGE_HINT: Record<TabRange, string> = {
  summary: "Overdue, due today, due in the next 7 days and completed today",
  all: "Every open task given to you, whatever its due date, and what you completed today",
};
export const BOARD_SECTIONS = ["date", "mine"] as const;
export type BoardSections = (typeof BOARD_SECTIONS)[number];
export const BOARD_SECTIONS_LABEL: Record<BoardSections, string> = { date: "By date", mine: "My sections" };
export const isTabRange = (value: unknown): value is TabRange => typeof value === "string" && (TAB_RANGES as readonly string[]).includes(value);

// A tab's Task Summary settings, read from its stored view state (any type).
export function tabSettings(config: unknown): { range: TabRange; sections: BoardSections } {
  const value = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  return { range: isTabRange(value.range) ? value.range : "summary", sections: value.sections === "mine" ? "mine" : "date" };
}

// The open/completed part of the list's WHERE for a range. `IST_DUE` is the
// task's India due day; params: [weekEnd?, todayStart, recentSince?].
export const OPEN_SQL = "t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')";
export function rangeWhere(range: TabRange, recentOn: boolean): { sql: string; uses: ("weekEnd" | "todayStart" | "recentSince")[] } {
  const IST_DUE = "DATE(DATE_ADD(t.due_at, INTERVAL 330 MINUTE))";
  if (range === "all") return { sql: `(${OPEN_SQL} OR (t.status = 'COMPLETED' AND t.completed_at >= ?))`, uses: ["todayStart"] };
  return {
    sql: `((${OPEN_SQL} AND t.due_at IS NOT NULL AND ${IST_DUE} <= ?) OR (t.status = 'COMPLETED' AND t.completed_at >= ?)${recentOn ? ` OR (${OPEN_SQL} AND t.created_by <> t.assignee_id AND t.assigned_at >= ?)` : ""})`,
    uses: recentOn ? ["weekEnd", "todayStart", "recentSince"] : ["weekEnd", "todayStart"],
  };
}
// How many rows a range lists at most (the list is windowed, D-367).
export const rangeLimit = (range: TabRange) => (range === "all" ? 2000 : 1000);

// ---- my sections ----------------------------------------------------------------------
export type MySystem = "OVERDUE" | "RECENT" | "TODAY" | "UPCOMING" | "LATER";
export interface MySectionLite {
  id: number;
  system: MySystem | null;
}
// Which of the person's sections a task shows in.
export function mySectionOf(task: { open: boolean; dueDay: string | null }, placement: { sectionId: number } | null, sections: readonly MySectionLite[], today: string): number {
  const bySystem = (key: MySystem) => sections.find((section) => section.system === key)?.id;
  if (task.open && task.dueDay !== null && task.dueDay < today) {
    const overdue = bySystem("OVERDUE");
    if (overdue !== undefined) return overdue;
  }
  if (placement && sections.some((section) => section.id === placement.sectionId && section.system !== "OVERDUE")) return placement.sectionId;
  return bySystem("RECENT") ?? sections[0]?.id ?? 0;
}

// ---- rules (auto-promotion, spec §4.3, BR-MYT-012) ----------------------------------------
export const MAX_UPCOMING_DAYS = 30;
export const myRulesSchema = z.object({
  todayOn: z.boolean(),
  upcomingOn: z.boolean(),
  upcomingDays: z.number().int().min(1).max(MAX_UPCOMING_DAYS),
});
export type MyRules = z.infer<typeof myRulesSchema>;
export const DEFAULT_MY_RULES: MyRules = { todayOn: true, upcomingOn: true, upcomingDays: 7 };

// The section a rule moves an open task to tonight, or null. "Today": due
// today. "Upcoming": due after today and within N working days (weekly offs
// and holidays don't count). An overdue task stays where it is (it shows in
// Overdue anyway). Applies from any section, but once per due day: a task the
// rule already moved for this due day (ruleKey) is left alone, so the person
// can move it back.
export function promotionTarget(
  task: { open: boolean; dueDay: string | null; system: MySystem | null; ruleKey: string | null },
  rules: MyRules,
  today: string,
  calendar: WorkCalendar,
): { to: "TODAY" | "UPCOMING"; key: string } | null {
  if (!task.open || task.dueDay === null || task.dueDay < today) return null;
  let to: "TODAY" | "UPCOMING" | null = null;
  if (task.dueDay === today) to = rules.todayOn ? "TODAY" : null;
  else if (rules.upcomingOn) {
    const days = workingDaysBetween(addDays(today, 1), task.dueDay, calendar);
    if (days !== null && days <= rules.upcomingDays) to = "UPCOMING";
  }
  if (!to) return null;
  // Never backwards: a task the person put in Today stays there.
  if (to === "UPCOMING" && task.system === "TODAY") return null;
  const key = `${to}:${task.dueDay}`;
  if (task.ruleKey === key || task.system === to) return null;
  return { to, key };
}

// The rules run once per India day per person, from 00:00 India time.
export const shouldRunFor = (lastRunDay: string | null, today: string) => lastRunDay === null || lastRunDay < today;

// A rule's words, for the settings panel and the task's activity.
export function rulesText(rules: MyRules): string[] {
  const out: string[] = [];
  if (rules.todayOn) out.push("Move to Today when the task is due today");
  if (rules.upcomingOn) out.push(`Move to Upcoming when the task is due within ${rules.upcomingDays} working day${rules.upcomingDays === 1 ? "" : "s"}`);
  return out;
}

// ---- Task visibility column (spec §3.12) ---------------------------------------------------
export type ProjectPrivacy = "PRIVATE" | "DEPARTMENT" | "ORGANISATION";
// Who can see a task, in a few words, from the privacy of its projects (the
// widest wins): everyone at ARS, a department, a project's members; a task in
// no project is seen by its collaborators (assignee, creator, followers).
// Managers above the assignee also see it (D-216): the tooltip says so.
export function visibilityLabel(projects: readonly { name: string; privacy?: ProjectPrivacy | null; departmentName?: string | null }[]): { kind: "ORGANISATION" | "DEPARTMENT" | "PRIVATE" | "COLLABORATORS"; text: string } {
  if (!projects.length) return { kind: "COLLABORATORS", text: "Collaborators" };
  if (projects.some((project) => project.privacy === "ORGANISATION")) return { kind: "ORGANISATION", text: "Everyone at ARS" };
  const department = projects.find((project) => project.privacy === "DEPARTMENT");
  if (department) return { kind: "DEPARTMENT", text: department.departmentName ? `${department.departmentName} department` : "Project's department" };
  return { kind: "PRIVATE", text: `${projects[0]!.name} members` };
}
export const VISIBILITY_TIP = "Also seen by the managers above the assignee (reporting hierarchy).";

// ---- toolbar chips (spec §3.8) -------------------------------------------------------------
// "Filters: N", "Sorts: N", "Groups: N", each with × to clear.
export function chipText(kind: "Filters" | "Sorts" | "Groups", count: number): string {
  const single = kind.slice(0, -1);
  return count > 0 ? `${kind}: ${count}` : single === "Filter" ? "Filter" : single;
}
