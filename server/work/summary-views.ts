import { z } from "zod";
import { DEFAULT_GRID, DEFAULT_HIDDEN, GRID_CONFIG_VERSION, type GridConfig, type GridTask } from "@/server/work/grid";

// v1.77.0 (D-404, owner's Task Summary decision 3, release 2 "organise and
// share"). Pure and unit-tested; the services and the page use these.
//
// 1. Who may open someone's Task Summary (always read-only for anyone but its
//    owner): the owner; anyone above them in the reporting chain (D-216, every
//    level); a person the owner shared it with (an active grant). Nobody else,
//    IT included (deny by default; IT already has Records → Tasks). Someone
//    else's list is only opened while its owner is active.
// 2. What a viewer sees: only the tasks they may see themselves (the task
//    visibility rule, visibleTaskClause). Tasks they can't see are left out
//    altogether (no title, no row, not counted in the cards), never masked.
// 3. Customise › Fields: which columns a Task Summary list shows by default.
// 4. Per-tab Board and Calendar settings for Task Summary tabs.
export type SummaryAccess = "OWN" | "MANAGER" | "SHARED" | null;

export function summaryAccessOf(input: { viewerId: number; ownerId: number; ownerActive: boolean; viewerTeamIds: readonly number[]; granted: boolean }): SummaryAccess {
  if (input.viewerId === input.ownerId) return "OWN";
  if (!input.ownerActive) return null;
  if (input.viewerTeamIds.includes(input.ownerId)) return "MANAGER";
  if (input.granted) return "SHARED";
  return null;
}
export const ACCESS_LABEL: Record<Exclude<SummaryAccess, null>, string> = {
  OWN: "Your Task Summary",
  MANAGER: "You manage them (reporting line)",
  SHARED: "Shared with you",
};

// ---- sharing -------------------------------------------------------------------------------
export const MAX_SHARES = 50;
export const shareInputSchema = z.object({ op: z.enum(["add", "remove"]), userId: z.number().int().positive().max(1e10) });
export type ShareInput = z.infer<typeof shareInputSchema>;
// Why a grant can't be made, or null.
export function shareProblem(input: { ownerId: number; targetId: number; targetActive: boolean | null; activeShares: number; alreadyShared: boolean }): string | null {
  if (input.targetId === input.ownerId) return "That's you. Your Task Summary is always yours.";
  if (input.targetActive === null) return "Choose a person from the list.";
  if (!input.targetActive) return "That person's account is inactive.";
  if (input.alreadyShared) return null;
  if (input.activeShares >= MAX_SHARES) return `You can share with at most ${MAX_SHARES} people. Remove someone first.`;
  return null;
}

// A row for someone else's Task Summary: nothing on it can be changed from there.
export const readOnlyRow = (row: GridTask): GridTask => ({ ...row, canEdit: false, canComplete: false });

// ---- Customise › Fields ---------------------------------------------------------------------
// v1.93.0 (D-446): + Start date, Completed date, Last comment; Created by is
// off by default (DEFAULT_FIELDS) and can be ticked back here or in Options.
export const SUMMARY_COLUMNS = ["start", "due", "priority", "collaborators", "createdBy", "projects", "visibility", "completed", "lastComment"] as const;
export type SummaryColumn = (typeof SUMMARY_COLUMNS)[number];
export const FIELDS_SETTING = "work.my_tasks.fields";
export const summaryFieldsSchema = z.object({
  hidden: z.array(z.enum(SUMMARY_COLUMNS)).max(SUMMARY_COLUMNS.length).default([]),
  hiddenFields: z.array(z.number().int().positive().max(1e10)).max(200).default([]),
});
export type SummaryFields = z.infer<typeof summaryFieldsSchema>;
export const DEFAULT_FIELDS: SummaryFields = { hidden: DEFAULT_HIDDEN.filter((column): column is SummaryColumn => (SUMMARY_COLUMNS as readonly string[]).includes(column)), hiddenFields: [] };
// v1.93.0 (D-447): columns saved before v1.93.0 (no "v") are read with Created by hidden too, as list views are.
export function parseSummaryFields(raw: string | null | undefined): SummaryFields {
  if (!raw) return DEFAULT_FIELDS;
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = summaryFieldsSchema.safeParse(value);
    if (!parsed.success) return DEFAULT_FIELDS;
    const old = !(value && typeof value === "object" && (value as Record<string, unknown>).v === GRID_CONFIG_VERSION);
    const hidden = old ? [...parsed.data.hidden, ...DEFAULT_FIELDS.hidden] : parsed.data.hidden;
    return { hidden: [...new Set(hidden)], hiddenFields: [...new Set(parsed.data.hiddenFields)] };
  } catch {
    return DEFAULT_FIELDS;
  }
}
// The starting view of a Task Summary list (new tabs, the built-in List, Reset).
export const summaryListStart = (fields: SummaryFields): GridConfig => ({ ...DEFAULT_GRID, group: "section", hidden: [...fields.hidden], hiddenFields: [...fields.hiddenFields] });
// "Also use for my List tabs": a stored list view with the chosen columns.
export const withFields = (config: GridConfig, fields: SummaryFields): GridConfig => ({ ...config, hidden: [...fields.hidden], hiddenFields: [...fields.hiddenFields] });

// ---- per-tab Board and Calendar settings ------------------------------------------------------
export const SHOW_CHOICES = ["all", "incomplete", "completed"] as const;
export type ShowChoice = (typeof SHOW_CHOICES)[number];
export const SUMMARY_BOARD_SORTS = ["manual", "due", "priority", "title"] as const;
export type SummaryBoardSort = (typeof SUMMARY_BOARD_SORTS)[number];
export const SUMMARY_BOARD_SORT_LABEL: Record<SummaryBoardSort, string> = { manual: "None", due: "Due date", priority: "Priority", title: "Alphabetical" };
export const summaryBoardSchema = z.object({
  show: z.enum(SHOW_CHOICES).default("all"),
  dueWithin: z.enum(["", "this", "next"]).default(""),
  sort: z.enum(SUMMARY_BOARD_SORTS).default("manual"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  search: z.string().max(100).default(""),
});
export type SummaryBoard = z.infer<typeof summaryBoardSchema>;
export const DEFAULT_SUMMARY_BOARD: SummaryBoard = summaryBoardSchema.parse({});
export const summaryCalendarSchema = z.object({
  show: z.enum(SHOW_CHOICES).default("all"),
  weekends: z.boolean().default(true),
  unit: z.enum(["month", "week"]).default("month"),
});
export type SummaryCalendar = z.infer<typeof summaryCalendarSchema>;
export const DEFAULT_SUMMARY_CALENDAR: SummaryCalendar = summaryCalendarSchema.parse({});

// The stored view of a Task Summary Board or Calendar tab (unknown keys and
// bad values fall back to the defaults; range/sections are read separately).
export function parseSummaryBoard(raw: unknown): SummaryBoard {
  const parsed = summaryBoardSchema.safeParse(raw && typeof raw === "object" ? pick(raw, ["show", "dueWithin", "sort", "dir", "search"]) : {});
  return parsed.success ? parsed.data : DEFAULT_SUMMARY_BOARD;
}
export function parseSummaryCalendar(raw: unknown): SummaryCalendar {
  const parsed = summaryCalendarSchema.safeParse(raw && typeof raw === "object" ? pick(raw, ["show", "weekends", "unit"]) : {});
  return parsed.success ? parsed.data : DEFAULT_SUMMARY_CALENDAR;
}
// Strict, for a save: null when it isn't a valid view of that type.
export function validSummaryView(type: "BOARD" | "CALENDAR", raw: unknown): SummaryBoard | SummaryCalendar | null {
  const parsed = (type === "BOARD" ? summaryBoardSchema : summaryCalendarSchema).strict().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// The Board's cards after its filter, search and sort. `today` is the India day.
const RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const OPEN = new Set(["OPEN", "IN_PROGRESS", "BLOCKED"]);
export function boardCards<T extends { id: number; title: string; status: string; dueAt: string | null; priority?: string; position: number }>(cards: readonly T[], view: SummaryBoard, today: string): T[] {
  const words = view.search.toLowerCase().split(/\s+/).filter(Boolean);
  const monday = mondayOf(today);
  const inWeek = (card: T, offset: number) => {
    if (!card.dueAt) return false;
    const day = indiaDay(card.dueAt);
    return day >= addDays(monday, offset * 7) && day < addDays(monday, offset * 7 + 7);
  };
  const list = cards.filter(
    (card) =>
      (view.show === "all" || (view.show === "completed" ? card.status === "COMPLETED" : OPEN.has(card.status))) &&
      (!view.dueWithin || inWeek(card, view.dueWithin === "this" ? 0 : 1)) &&
      words.every((word) => card.title.toLowerCase().includes(word)),
  );
  const sign = view.dir === "desc" ? -1 : 1;
  const key = (card: T): string | number => (view.sort === "due" ? (card.dueAt ?? "9999") : view.sort === "priority" ? (RANK[card.priority ?? "NORMAL"] ?? 2) : view.sort === "title" ? card.title.toLowerCase() : card.position);
  return [...list].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (view.sort === "manual" ? 1 : sign) || a.id - b.id;
  });
}
export const boardFilterCount = (view: SummaryBoard) => Number(view.show !== "all") + Number(Boolean(view.dueWithin));

function pick(value: object, keys: string[]): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}
const indiaDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
