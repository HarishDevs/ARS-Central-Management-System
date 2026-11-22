import { z } from "zod";
import { DEFAULT_GRID, gridConfigSchema, parseGridConfig, type GridConfig } from "@/server/work/grid";
import { fieldFilterSchema } from "@/server/work/custom-fields";

// v1.61.0 (D-367, PM phase A, spec PRJ-15 "tab strip and saved views"): every
// view of a project can be a saved tab: List, Board, Calendar, Timeline and
// Overview. A tab has a type, a name, its view state (filters, sort, grouping,
// columns) and one tab is the project's default. Pure and unit-tested; the
// repository stores the rows, the actions check permissions, ViewTabs draws it.
// v1.67.0 (D-375): DASHBOARD and WORKLOAD tabs ("pm_reporting").
// v1.71.0 (D-384): FILES, MESSAGES and PAGE tabs ("pm_extras").
export const TAB_VIEWS = ["OVERVIEW", "LIST", "BOARD", "TIMELINE", "CALENDAR", "GANTT", "DASHBOARD", "WORKLOAD", "FILES", "MESSAGES", "PAGE"] as const;
export type TabView = (typeof TAB_VIEWS)[number];
export const TAB_VIEW_LABEL: Record<TabView, string> = { OVERVIEW: "Overview", LIST: "List", BOARD: "Board", TIMELINE: "Timeline", CALENDAR: "Calendar", GANTT: "Gantt", DASHBOARD: "Dashboard", WORKLOAD: "Workload", FILES: "Files", MESSAGES: "Messages", PAGE: "Page" };

// The "Add tab" catalogue. Views not built yet are listed but hidden
// (`available: false`), so the catalogue grows without changing its shape.
export interface CatalogueEntry {
  type: string;
  label: string;
  description: string;
  available: boolean;
  planning?: boolean; // v1.65.0 (D-373): only with the "pm_planning" switch on
  reporting?: boolean; // v1.67.0 (D-375): only with the "pm_reporting" switch on
  extras?: boolean; // v1.71.0 (D-384): only with the "pm_extras" switch on
}
export const VIEW_CATALOGUE: readonly CatalogueEntry[] = [
  { type: "LIST", label: "List", description: "Tasks in rows, with sections, filters, sort and groups.", available: true },
  { type: "BOARD", label: "Board", description: "Tasks as cards in columns by section.", available: true },
  { type: "CALENDAR", label: "Calendar", description: "Tasks on a month or week calendar by date.", available: true },
  { type: "TIMELINE", label: "Timeline", description: "Tasks as bars from start to due date.", available: true },
  { type: "OVERVIEW", label: "Overview", description: "About the project, milestones, members and status updates.", available: true },
  { type: "GANTT", label: "Gantt", description: "Tasks, their dates and dependencies on a schedule.", available: true, planning: true },
  { type: "DASHBOARD", label: "Dashboard", description: "Charts and numbers about the project's tasks.", available: true, reporting: true },
  { type: "WORKLOAD", label: "Workload", description: "Who has how much work, by day or week, against capacity.", available: true, reporting: true },
  { type: "FILES", label: "Files", description: "Every file on the project's tasks, form submissions and messages.", available: true, extras: true },
  { type: "MESSAGES", label: "Messages", description: "Conversations with the project's members.", available: true, extras: true },
  { type: "PAGE", label: "Page", description: "The project's brief: one page everyone can read.", available: true, extras: true },
];
// v1.63.0 (D-369, PM-A13): My Tasks has its own strip, per person, with the
// three views My Tasks draws (List, Board, Calendar).
export type TabScope = "PROJECT" | "MY_TASKS";
export const MY_TASKS_VIEWS: readonly TabView[] = ["LIST", "BOARD", "CALENDAR"];
export const addableViews = (scope: TabScope = "PROJECT", planning = false, reporting = false, extras = false): CatalogueEntry[] =>
  VIEW_CATALOGUE.filter((entry) => entry.available && (planning || !entry.planning) && (reporting || !entry.reporting) && (extras || !entry.extras) && (scope === "PROJECT" || (MY_TASKS_VIEWS as readonly string[]).includes(entry.type)));
export const REPORTING_VIEWS: readonly TabView[] = ["DASHBOARD", "WORKLOAD"];
export const EXTRAS_VIEWS: readonly TabView[] = ["FILES", "MESSAGES", "PAGE"];
export const allowedView = (scope: TabScope, type: unknown, planning = false, reporting = false, extras = false): type is TabView =>
  isTabView(type) && (planning || type !== "GANTT") && (reporting || !REPORTING_VIEWS.includes(type)) && (extras || !EXTRAS_VIEWS.includes(type)) && (scope === "PROJECT" || MY_TASKS_VIEWS.includes(type));
export const isTabView = (value: unknown): value is TabView => typeof value === "string" && (TAB_VIEWS as readonly string[]).includes(value);

export const MAX_PROJECT_TABS = 50;
export const MAX_MY_TABS = 30; // D-220's limit for a person's own tabs
export const maxTabs = (scope: TabScope) => (scope === "PROJECT" ? MAX_PROJECT_TABS : MAX_MY_TABS);
export const TAB_NAME_MAX = 60;

// A tab's name: spaces folded, 1–60 characters, no control characters.
export function cleanTabName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > TAB_NAME_MAX) return null;
  return name;
}

// "Name", "Name (2)", "Name (3)"… the first one not taken (case-insensitive,
// like the database's unique key).
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((item) => item.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, TAB_NAME_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${name.slice(0, TAB_NAME_MAX - 14)} (${Date.now() % 1e9})`;
}
export const copyName = (name: string, taken: Iterable<string>) => uniqueName(`${name.slice(0, TAB_NAME_MAX - 7)} (copy)`, taken);

// ---- view state of each tab type --------------------------------------------------------
// Board: the board's own toolbar (filters, "Just my tasks", due this or next
// week, sort and order, search).
export const BOARD_SORTS = ["manual", "due", "priority", "title", "assignee"] as const;
export const boardConfigSchema = z.object({
  incomplete: z.boolean().default(true),
  showDone: z.boolean().default(false),
  mine: z.boolean().default(false),
  dueWithin: z.enum(["", "this", "next"]).default(""),
  sort: z.enum(BOARD_SORTS).default("manual"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  sortField: z.number().int().positive().nullable().default(null),
  search: z.string().max(100).default(""),
  // v1.64.0 (D-371, "pm_planning"): custom field filters, and columns by a
  // custom field instead of sections (null = sections).
  fieldFilters: z.array(fieldFilterSchema).max(10).default([]),
  groupField: z.number().int().positive().nullable().default(null),
});
export type BoardConfig = z.infer<typeof boardConfigSchema>;
export const DEFAULT_BOARD: BoardConfig = boardConfigSchema.parse({});
export const DEFAULT_PROJECT_LIST: GridConfig = { ...DEFAULT_GRID, group: "section" };

export type TabConfig = GridConfig | BoardConfig | Record<string, never>;
// Only known keys and values are kept; anything else falls back to the default.
export function parseTabConfig(type: TabView, raw: unknown): TabConfig {
  if (type === "LIST") {
    const value = typeof raw === "string" ? safeJson(raw) : raw;
    return value && typeof value === "object" && Object.keys(value).length ? parseGridConfig(value) : DEFAULT_PROJECT_LIST;
  }
  if (type === "BOARD") {
    const parsed = boardConfigSchema.safeParse(typeof raw === "string" ? safeJson(raw) : (raw ?? {}));
    return parsed.success ? parsed.data : DEFAULT_BOARD;
  }
  return {};
}
// Strict check for what a person sends to "Save view": refused when it isn't a
// valid view state for that tab type (the server never stores junk).
export function validTabConfig(type: TabView, raw: unknown): TabConfig | null {
  if (type === "LIST") {
    const parsed = gridConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  if (type === "BOARD") {
    const parsed = boardConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  return {};
}

// ---- the strip --------------------------------------------------------------------------
export interface TabRow {
  id: number;
  type: TabView;
  name: string;
  config: unknown;
  isDefault: boolean;
  position: number;
}
export interface StripTab {
  key: string; // "t<id>" for a stored tab, "v<TYPE>" for a built-in view not stored yet
  id: number | null;
  type: TabView;
  name: string;
  isDefault: boolean;
}
export const BASE_ORDER: readonly TabView[] = ["OVERVIEW", "LIST", "BOARD", "TIMELINE", "CALENDAR"];
export const baseOrder = (scope: TabScope): readonly TabView[] => (scope === "PROJECT" ? BASE_ORDER : MY_TASKS_VIEWS);
const defaultType = (defaultView: string): TabView => (isTabView(defaultView.toUpperCase()) ? (defaultView.toUpperCase() as TabView) : "LIST");

// The project's tabs in order. Before the strip is stored (tabsSet false):
// the five built-in views, with the saved List tabs (D-220) after List.
// v1.63.0 (D-369): My Tasks passes its own built-in views (List, Board, Calendar).
export function buildStrip(rows: readonly TabRow[], tabsSet: boolean, defaultView: string, base: readonly TabView[] = BASE_ORDER): StripTab[] {
  const ordered = [...rows].sort((a, b) => a.position - b.position || a.id - b.id);
  let strip: StripTab[];
  if (tabsSet) strip = ordered.map((row) => ({ key: `t${row.id}`, id: row.id, type: row.type, name: row.name, isDefault: row.isDefault }));
  else
    strip = base.flatMap((type) => [
      { key: `v${type}`, id: null, type, name: TAB_VIEW_LABEL[type], isDefault: false },
      ...(type === "LIST" ? ordered.map((row) => ({ key: `t${row.id}`, id: row.id, type: row.type, name: row.name, isDefault: row.isDefault })) : []),
    ]);
  if (!strip.length) return strip;
  if (!strip.some((tab) => tab.isDefault)) {
    const wanted = defaultType(defaultView);
    const index = Math.max(
      0,
      strip.findIndex((tab) => tab.type === wanted),
    );
    strip = strip.map((tab, at) => ({ ...tab, isDefault: at === index }));
  } else {
    // At most one default (the first marked one wins).
    let seen = false;
    strip = strip.map((tab) => {
      const isDefault = tab.isDefault && !seen;
      if (tab.isDefault) seen = true;
      return { ...tab, isDefault };
    });
  }
  return strip;
}

// The tab the address asks for: ?tab=<id>, else ?view=<type> (the first tab of
// that type, the default one if it is of that type), else the default tab.
export function pickTab(strip: readonly StripTab[], query: { tab?: string | null; view?: string | null }): StripTab | null {
  if (!strip.length) return null;
  const byId = query.tab && /^\d{1,10}$/.test(query.tab) ? strip.find((tab) => tab.id === Number(query.tab)) : undefined;
  if (byId) return byId;
  const type = (query.view ?? "").toUpperCase();
  if (isTabView(type)) {
    const ofType = strip.filter((tab) => tab.type === type);
    if (ofType.length) return ofType.find((tab) => tab.isDefault) ?? ofType.find((tab) => tab.id === null) ?? ofType[0]!;
  }
  return strip.find((tab) => tab.isDefault) ?? strip[0]!;
}

// v1.77.0 (D-404): a base that has a query already (Task Summary ?of=) gets "&".
export const tabHref = (base: string, tab: Pick<StripTab, "id" | "type">) => `${base}${base.includes("?") ? "&" : "?"}${tab.id !== null ? `tab=${tab.id}` : `view=${tab.type.toLowerCase()}`}`;

// Keyboard reorder: move one key by delta (−1 left, +1 right), clamped.
export function moveKey(keys: readonly string[], key: string, delta: number): string[] {
  const from = keys.indexOf(key);
  if (from < 0) return [...keys];
  const to = Math.min(keys.length - 1, Math.max(0, from + delta));
  const out = [...keys];
  out.splice(from, 1);
  out.splice(to, 0, key);
  return out;
}
// Drag reorder: put `key` just before `beforeKey` (null: at the end).
export function placeKey(keys: readonly string[], key: string, beforeKey: string | null): string[] {
  if (!keys.includes(key) || key === beforeKey) return [...keys];
  const rest = keys.filter((item) => item !== key);
  const at = beforeKey === null ? rest.length : rest.indexOf(beforeKey);
  rest.splice(at < 0 ? rest.length : at, 0, key);
  return rest;
}
// A new order must be the same set of tabs, each once.
export function sameTabs(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && new Set(next).size === next.length && next.every((key) => current.includes(key));
}

// What writing the strip stores: the built-in views as rows, in strip order,
// with names that don't clash with the saved tabs.
export function materialisePlan(strip: readonly StripTab[]): { key: string; id: number | null; type: TabView; name: string }[] {
  const taken = strip.filter((tab) => tab.id !== null).map((tab) => tab.name);
  return strip.map((tab) => {
    if (tab.id !== null) return { key: tab.key, id: tab.id, type: tab.type, name: tab.name };
    const name = uniqueName(tab.name, taken);
    taken.push(name);
    return { key: tab.key, id: null, type: tab.type, name };
  });
}

// v1.72.0 (D-387, spec PM §3.7.2): the Add tab menu in two groups, each in
// the spec's order: Popular (List, Page, Gantt, Board, Calendar, Timeline),
// then Other (Workload, Dashboard, Files, Messages, Overview).
const POPULAR_ORDER = ["LIST", "PAGE", "GANTT", "BOARD", "CALENDAR", "TIMELINE"];
const OTHER_ORDER = ["WORKLOAD", "DASHBOARD", "FILES", "MESSAGES", "OVERVIEW"];
export function catalogueGroups(entries: readonly CatalogueEntry[]): { name: "Popular" | "Other"; entries: CatalogueEntry[] }[] {
  const pick = (order: string[]) => order.map((type) => entries.find((entry) => entry.type === type)).filter((entry): entry is CatalogueEntry => Boolean(entry));
  const known = new Set([...POPULAR_ORDER, ...OTHER_ORDER]);
  const groups = [
    { name: "Popular" as const, entries: pick(POPULAR_ORDER) },
    { name: "Other" as const, entries: [...pick(OTHER_ORDER), ...entries.filter((entry) => !known.has(entry.type))] },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

// v1.72.0 (D-387, spec PM §3.7.3): the tab menu's entries in the spec's order
// (Rename, Set as default, Make a copy, Copy link, then our Move left / right,
// then Remove). "Set as default" stays listed, disabled, on the default tab.
export type TabMenuEntry = { key: "rename" | "default" | "duplicate" | "copy" | "left" | "right" | "remove"; disabled?: boolean } | { key: "separator" };
export function tabMenuEntries(tab: StripTab, strip: readonly StripTab[], canEdit: boolean, max: number = MAX_PROJECT_TABS): TabMenuEntry[] {
  const allowed = tabMenu(tab, strip, canEdit, max);
  const index = strip.findIndex((one) => one.key === tab.key);
  const out: TabMenuEntry[] = [];
  if (allowed.includes("rename")) out.push({ key: "rename" });
  if (canEdit) out.push({ key: "default", disabled: tab.isDefault });
  if (allowed.includes("duplicate")) out.push({ key: "duplicate" });
  out.push({ key: "copy" });
  const moves: TabMenuEntry[] = [];
  if (canEdit && index > 0) moves.push({ key: "left" });
  if (canEdit && index >= 0 && index < strip.length - 1) moves.push({ key: "right" });
  if (moves.length) out.push({ key: "separator" }, ...moves);
  if (allowed.includes("remove")) out.push({ key: "separator" }, { key: "remove" });
  return out;
}

// The last tab can't be removed (a project always shows at least one view).
export const canRemoveTab = (strip: readonly StripTab[]) => strip.length > 1;

// The menu's choices for one tab (editors only; the server checks again).
export function tabMenu(tab: StripTab, strip: readonly StripTab[], canEdit: boolean, max: number = MAX_PROJECT_TABS): ("rename" | "default" | "duplicate" | "copy" | "remove")[] {
  const out: ("rename" | "default" | "duplicate" | "copy" | "remove")[] = [];
  if (canEdit) out.push("rename");
  if (canEdit && !tab.isDefault) out.push("default");
  if (canEdit && strip.length < max) out.push("duplicate");
  out.push("copy");
  if (canEdit && canRemoveTab(strip)) out.push("remove");
  return out;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
