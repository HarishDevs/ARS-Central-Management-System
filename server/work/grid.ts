import { z } from "zod";
import { sortRows, type SortDir } from "@/server/lists/sorting";
import { fieldFilterSchema, fieldGroups, matchFieldFilter, viewDef, type CellMap, type FieldView } from "@/server/work/custom-fields";

// D-220 (owner: "the compact screen like this, table format… filters, sort,
// groups like Asana in all the screens"): one task table for every list in
// Tasks: numbered rows, grouping, Filters (quick filters + field filters),
// Sort, Groups, Options (columns) and Search. Pure and unit-tested; the
// table (features/work/TaskGrid.tsx) draws what this returns.
// v1.93.0 (D-446, owner 27 Nov 2026): + Start date, Completed date and Last
// comment in the column library.
export const GRID_COLUMNS = ["due", "assignee", "collaborators", "createdBy", "projects", "visibility", "priority", "tags", "start", "completed", "lastComment"] as const;
export type GridColumn = (typeof GRID_COLUMNS)[number];
export const COLUMN_LABEL: Record<GridColumn, string> = {
  start: "Start date",
  completed: "Completed date",
  lastComment: "Last comment",
  due: "Due date",
  assignee: "Assignee",
  collaborators: "Collaborators",
  createdBy: "Created by",
  projects: "Projects",
  visibility: "Task visibility",
  priority: "Priority",
  tags: "Tags",
};
// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): + collaborators, projects, visibility and tags, so every column
// of the table sorts from its title (with `dir`).
// v1.61.0 (D-367, spec PRJ-04): + "modified" (last changed).
// v1.93.0 (D-446): + "lastComment" (the newest comment first).
export const SORTS = ["none", "due", "start", "assignee", "createdBy", "createdOn", "modified", "completedOn", "likes", "alpha", "priority", "collaborators", "projects", "visibility", "tags", "lastComment"] as const;
export type GridSort = (typeof SORTS)[number];
// v1.72.0 (D-387, spec PM §3.8.2): the Sort menu's order: None, then Start
// date, Due date, Assignee, Created by, Created on, Last modified, Completed on,
// Likes, Alphabetical, then the built-in fields (custom fields follow them),
// Project last. Only the sorts a table offers are kept.
export const SORT_MENU_ORDER: readonly GridSort[] = ["none", "start", "due", "assignee", "createdBy", "createdOn", "modified", "completedOn", "lastComment", "likes", "alpha", "priority", "collaborators", "tags", "visibility", "projects"];
export function sortMenu(offered: readonly GridSort[]): { before: GridSort[]; after: GridSort[] } {
  const ordered = SORT_MENU_ORDER.filter((sort) => offered.includes(sort));
  return { before: ordered.filter((sort) => sort !== "projects"), after: ordered.filter((sort) => sort === "projects") };
}
export const SORT_LABEL: Record<GridSort, string> = {
  none: "None",
  due: "Due date",
  start: "Start date",
  assignee: "Assignee",
  createdBy: "Created by",
  createdOn: "Created on",
  modified: "Last modified",
  completedOn: "Completed on",
  likes: "Likes",
  alpha: "Alphabetical",
  priority: "Priority",
  collaborators: "Collaborators",
  projects: "Projects",
  visibility: "Task visibility",
  tags: "Tags",
  lastComment: "Last comment",
};
// v1.57.3 (D-341): "department" = the assignee's department.
// v1.76.0 (D-401): "mySection" = Task Summary's "My sections" (the person's own sections).
export const GROUPS = ["none", "section", "assignee", "department", "createdBy", "project", "due", "priority", "kind", "mySection"] as const;
export type GridGroup = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<GridGroup, string> = { none: "None", section: "Sections", assignee: "Assignee", department: "Department", createdBy: "Created by", project: "Project", due: "Due date", priority: "Priority", kind: "Periodic or ad hoc", mySection: "My sections" };
export const FILTER_FIELDS = ["completion", "assignee", "createdBy", "project", "priority", "kind", "due", "start", "tag"] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];
export const FILTER_LABEL: Record<FilterField, string> = {
  completion: "Completion status",
  assignee: "Assignee",
  createdBy: "Created by",
  project: "Project",
  priority: "Priority",
  kind: "Periodic or ad hoc",
  due: "Due date",
  start: "Start date",
  tag: "Tag",
};

// v1.75.0 (D-399, spec DATE_RANGES §6, BR-DATE-008): a date window filter's
// value: "between:FROM:TO" or "notbetween:FROM:TO" (both days included; a
// window still missing a day filters nothing).
const WINDOW_RE = /^(between|notbetween):(\d{4}-\d{2}-\d{2})?:(\d{4}-\d{2}-\d{2})?$/;
export function parseDateWindow(value: string): { not: boolean; from: string; to: string } | null {
  const match = WINDOW_RE.exec(value);
  return match ? { not: match[1] === "notbetween", from: match[2] ?? "", to: match[3] ?? "" } : null;
}
export function dateWindowValue(not: boolean, from: string, to: string): string {
  return `${not ? "notbetween" : "between"}:${from}:${to}`;
}
/** Does a day pass the window? Null (no window yet) passes. */
export function passesWindow(day: string | null, value: string): boolean | null {
  const window = parseDateWindow(value);
  if (!window) return null;
  if (!window.from || !window.to) return true;
  const from = window.from <= window.to ? window.from : window.to;
  const to = window.from <= window.to ? window.to : window.from;
  const inside = day !== null && day >= from && day <= to;
  return window.not ? !inside : inside;
}
export const COMPLETED_RANGES = ["none", "all", "today", "week", "month"] as const;

// v1.93.0 (D-446, D-447): the column library's default view leaves Created by
// out (it can be added back from Options). `v` is the config's version: a view
// saved before v1.93.0 (no `v`) is read with Created by hidden as well, so every
// table shows the new defaults; what its owner hid stays hidden, and Start date,
// Completed date and Last comment show (they weren't in the library before).
export const DEFAULT_HIDDEN: readonly GridColumn[] = ["createdBy"];
export const GRID_CONFIG_VERSION = 2;
// A column key of the order: a built-in column or a custom field ("f12").
const COLUMN_KEY = /^(?:[a-zA-Z]{2,20}|f\d{1,10})$/;
export function upgradeGridConfig(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  if (value.v === GRID_CONFIG_VERSION) return raw;
  const hidden = Array.isArray(value.hidden) ? value.hidden : [];
  return { ...value, v: GRID_CONFIG_VERSION, hidden: [...new Set([...hidden, ...DEFAULT_HIDDEN])] };
}

const gridConfigObject = z.object({
  v: z.literal(GRID_CONFIG_VERSION).default(GRID_CONFIG_VERSION),
  incomplete: z.boolean().default(true),
  completed: z.enum(COMPLETED_RANGES).default("none"),
  dueThisWeek: z.boolean().default(false),
  dueNextWeek: z.boolean().default(false),
  filters: z.array(z.object({ field: z.enum(FILTER_FIELDS), value: z.string().max(100) })).max(10).default([]),
  sort: z.enum(SORTS).default("none"),
  // v1.58.0 (D-354): the direction of the sort ("desc" reverses the sort's own
  // order), and a project field's id when the sort is by one of its own columns.
  // Both are kept in saved tabs with the rest of the view.
  dir: z.enum(["asc", "desc"]).default("asc"),
  sortField: z.number().int().positive().nullable().default(null),
  group: z.enum(GROUPS).default("none"),
  hidden: z.array(z.enum(GRID_COLUMNS)).max(GRID_COLUMNS.length * 2).default([]),
  // v1.93.0 (D-446): the view's column order (built-in columns and custom
  // fields, "f12"); empty = the table's own order. Columns not listed keep
  // their place after the column they follow by default (orderColumns).
  columnOrder: z.array(z.string().regex(COLUMN_KEY)).max(520).default([]),
  search: z.string().max(100).default(""),
  // v1.61.0 (D-367): the section menu's "Hide empty groups", saved with the view.
  hideEmpty: z.boolean().default(false),
  // v1.64.0 (D-371, "pm_planning"): filters on custom fields, grouping by a
  // custom field, and the field columns hidden in this view.
  fieldFilters: z.array(fieldFilterSchema).max(10).default([]),
  groupField: z.number().int().positive().nullable().default(null),
  hiddenFields: z.array(z.number().int().positive()).max(500).default([]),
});
export const gridConfigSchema = z.preprocess(upgradeGridConfig, gridConfigObject);
export type GridConfig = z.infer<typeof gridConfigObject>;
export const DEFAULT_GRID: GridConfig = gridConfigSchema.parse({});

// v1.93.0 (D-446): the columns in the view's order. Keys the order lists come
// first in that order; a key it doesn't list (a new column or field) goes just
// after the column it follows in `keys` (the table's own order), or first.
export function orderColumns<T extends string>(keys: readonly T[], order: readonly string[]): T[] {
  const known = new Set<string>(keys);
  const out: T[] = [];
  for (const key of order) if (known.has(key) && !out.includes(key as T)) out.push(key as T);
  keys.forEach((key, index) => {
    if (out.includes(key)) return;
    let at = 0;
    for (let back = index - 1; back >= 0; back -= 1) {
      const place = out.indexOf(keys[back]!);
      if (place >= 0) {
        at = place + 1;
        break;
      }
    }
    out.splice(at, 0, key);
  });
  return out;
}
// Move one column by delta (-1 left, +1 right) past its shown neighbour; the
// full order (hidden columns keep their places) is what's kept.
export function moveColumn(order: readonly string[], shown: readonly string[], key: string, delta: -1 | 1): string[] {
  const from = shown.indexOf(key);
  const neighbour = shown[from + delta];
  if (from < 0 || neighbour === undefined) return [...order];
  return delta < 0 ? placeColumn(order, key, neighbour) : placeColumn(order, key, null, neighbour);
}
// Put `key` just before `beforeKey`, else just after `afterKey`, else last.
export function placeColumn(order: readonly string[], key: string, beforeKey: string | null, afterKey: string | null = null): string[] {
  if (!order.includes(key) || key === beforeKey || key === afterKey) return [...order];
  const rest = order.filter((item) => item !== key);
  if (beforeKey !== null && rest.includes(beforeKey)) rest.splice(rest.indexOf(beforeKey), 0, key);
  else if (afterKey !== null && rest.includes(afterKey)) rest.splice(rest.indexOf(afterKey) + 1, 0, key);
  else rest.push(key);
  return rest;
}

// v1.93.0 (D-448): the last comment as a list cell shows it: plain text (the
// formatting marks and mention codes taken out), on one line.
export function commentPreview(body: string): string {
  return body
    .replace(/@\[([^\]\n]{1,80})\]\(user:\d{1,10}\)/g, "@$1")
    .replace(/\[([^\]\n]{1,200})\]\((?:https?:\/\/|mailto:)[^\s)]{1,500}\)/g, "$1")
    .replace(/^[ \t]*(?:[-*\u2022]|\d{1,3}[.)]|>|#{1,3})[ \t]+/gm, "")
    .replace(/\*\*|~~|\+\+|`/g, "")
    .replace(/(^|\s)[_*]([^_*\n]+)[_*](?=\s|$|[.,!?;:])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}
export function parseGridConfig(raw: unknown): GridConfig {
  const parsed = gridConfigSchema.safeParse(typeof raw === "string" ? safeJson(raw) : raw);
  return parsed.success ? parsed.data : DEFAULT_GRID;
}

export interface GridTask {
  id: number;
  taskNo: string;
  title: string;
  status: string;
  priority: "LOW" | "NORMAL" | "ELEVATED" | "IMPORTANT" | "HIGH" | "URGENT";
  assigneeId: number;
  assigneeName: string;
  assigneeDepartment?: string | null; // v1.57.3 (D-341)
  createdBy: number;
  createdByName: string;
  // v1.78.0 (D-405, spec §3.12 [SS]): employee codes, shown in person group headings ("Name · EMP123").
  assigneeCode?: string | null;
  createdByCode?: string | null;
  dueAt: string | null; // ISO
  startsOn: string | null;
  createdAt: string;
  updatedAt?: string | null; // v1.61.0 (D-367): the Modified sort
  parentId?: number | null; // v1.61.0: set on a subtask shown under its task
  completedAt: string | null;
  // v1.93.0 (D-448): the task's newest comment (replies too), deleted ones left out.
  lastComment?: { text: string; authorName: string; at: string } | null;
  likes: number;
  comments: number;
  subtasks: number;
  isPeriodic: boolean;
  isMilestone: boolean;
  // v1.76.0 (D-401): privacy and department for the Task visibility column.
  projects: { id: number; name: string; color: string; privacy?: "PRIVATE" | "DEPARTMENT" | "ORGANISATION"; departmentName?: string | null }[];
  tags: { id: number; name: string }[];
  followers: { id: number; name: string }[];
  sectionId: number | null;
  position: number;
  // v1.76.0 (D-401): Task Summary's "My sections": the person's own section and order.
  mySectionId?: number | null;
  myPosition?: number;
  canEdit: boolean; // may change its dates and fields here
  canComplete: boolean;
  approval?: { requestId: number; requestNo: string; workStep: boolean; linked?: boolean } | null; // v1.42.1: from an approval request
}

const OPEN = new Set(["OPEN", "IN_PROGRESS", "BLOCKED"]);
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, IMPORTANT: 2, ELEVATED: 3, NORMAL: 4, LOW: 5 } as const;
const PRIORITY_NAME = { URGENT: "Critical", HIGH: "Most Important", IMPORTANT: "Important", ELEVATED: "High", NORMAL: "Normal", LOW: "Low" } as const;
export const indiaDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const shift = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekStart = (day: string) => shift(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

// How many filters are on (the "Filters: N" count).
export function filterCount(config: GridConfig): number {
  return Number(!config.incomplete || config.completed !== "none") + Number(config.dueThisWeek) + Number(config.dueNextWeek) + config.filters.length + (config.fieldFilters?.length ?? 0);
}

function passes(task: GridTask, config: GridConfig, today: string, meId: number): boolean {
  const open = OPEN.has(task.status);
  const done = task.status === "COMPLETED";
  let completionOk = (config.incomplete && open) || false;
  if (done && config.completed !== "none") {
    const day = task.completedAt ? indiaDay(task.completedAt) : null;
    completionOk ||=
      config.completed === "all" || (day !== null && (config.completed === "today" ? day === today : config.completed === "week" ? day >= shift(today, -7) : day >= shift(today, -30)));
  }
  if (!completionOk) return false;
  const due = task.dueAt ? indiaDay(task.dueAt) : null;
  const start = weekStart(today);
  if (config.dueThisWeek && !(due && due >= start && due < shift(start, 7))) return false;
  if (config.dueNextWeek && !(due && due >= shift(start, 7) && due < shift(start, 14))) return false;
  for (const filter of config.filters) {
    const value = filter.value;
    switch (filter.field) {
      case "completion":
        if (value === "incomplete" && !open) return false;
        if (value === "completed" && !done) return false;
        break;
      case "assignee":
        if (String(value === "me" ? meId : value) !== String(task.assigneeId)) return false;
        break;
      case "createdBy":
        if (String(value === "me" ? meId : value) !== String(task.createdBy)) return false;
        break;
      case "project":
        if (value === "none" ? task.projects.length > 0 : !task.projects.some((project) => String(project.id) === value)) return false;
        break;
      case "priority":
        if (task.priority !== value) return false;
        break;
      case "kind":
        if ((value === "periodic") !== task.isPeriodic) return false;
        break;
      case "start": {
        const startDay = task.startsOn ?? null;
        const windowed = passesWindow(startDay, value);
        if (windowed === false) return false;
        if (value === "none" && startDay) return false;
        if (value === "set" && !startDay) return false;
        break;
      }
      case "due":
        if (passesWindow(due, value) === false) return false;
        if (value === "none" && due) return false;
        if (value === "overdue" && !(due && due < today && open)) return false;
        if (value === "today" && due !== today) return false;
        if (value === "next7" && !(due && due >= today && due <= shift(today, 7))) return false;
        break;
      case "tag":
        if (!task.tags.some((tag) => String(tag.id) === value || tag.name === value)) return false;
        break;
    }
  }
  const words = config.search.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => `${task.title} ${task.taskNo} ${task.assigneeName} ${task.tags.map((tag) => tag.name).join(" ")} ${task.projects.map((project) => project.name).join(" ")}`.toLowerCase().includes(word));
}

// v1.58.0 (D-354): each sort reads one value of the row; empty values stay last
// in both directions (sortRows). Created on, Completed on and Likes read
// newest / most first by themselves; "desc" reverses every sort's own order.
const SORT_VALUE: Record<Exclude<GridSort, "none">, (task: GridTask) => unknown> = {
  due: (task) => task.dueAt,
  start: (task) => task.startsOn,
  assignee: (task) => task.assigneeName,
  createdBy: (task) => task.createdByName,
  createdOn: (task) => task.createdAt,
  modified: (task) => task.updatedAt ?? task.createdAt,
  completedOn: (task) => task.completedAt,
  likes: (task) => task.likes,
  alpha: (task) => task.title,
  priority: (task) => PRIORITY_RANK[task.priority],
  collaborators: (task) => task.followers.map((person) => person.name).join(", "),
  projects: (task) => task.projects.map((project) => project.name).join(", "),
  visibility: (task) => (task.projects.length ? `${task.projects[0]!.name} members` : "Collaborators"),
  tags: (task) => task.tags.map((tag) => tag.name).join(", "),
  lastComment: (task) => task.lastComment?.at ?? null,
};
const NATURAL_DESC: ReadonlySet<GridSort> = new Set(["createdOn", "modified", "completedOn", "likes", "lastComment"]);

export function sortGridRows(rows: readonly GridTask[], config: Pick<GridConfig, "sort" | "dir" | "sortField">, values?: CellMap): GridTask[] {
  const manual = [...rows].sort((a, b) => a.position - b.position || a.id - b.id);
  if (config.sortField) {
    const field = config.sortField;
    // v1.64.0 (D-371): each type's own order (numbers, dates, options in their order).
    return sortRows(manual, (task) => values?.[task.id]?.[field]?.sort ?? null, config.dir);
  }
  if (config.sort === "none") return manual;
  const natural: SortDir = NATURAL_DESC.has(config.sort) ? "desc" : "asc";
  const dir: SortDir = config.dir === "desc" ? (natural === "asc" ? "desc" : "asc") : natural;
  return sortRows(manual, SORT_VALUE[config.sort], dir);
}

// v1.58.0 (D-354): a column title sorts by that column: first A→Z, again Z→A.
// "name" is the task's own column; a number is a project field's id.
export type SortableColumn = GridColumn | "name" | number;
const COLUMN_SORT: Record<GridColumn | "name", Exclude<GridSort, "none">> = {
  name: "alpha",
  due: "due",
  assignee: "assignee",
  collaborators: "collaborators",
  createdBy: "createdBy",
  projects: "projects",
  visibility: "visibility",
  priority: "priority",
  tags: "tags",
  start: "start",
  completed: "completedOn",
  lastComment: "lastComment",
};
export function columnSortState(config: Pick<GridConfig, "sort" | "dir" | "sortField">, column: SortableColumn): SortDir | null {
  if (typeof column === "number") return config.sortField === column ? config.dir : null;
  return !config.sortField && config.sort === COLUMN_SORT[column] ? config.dir : null;
}
export function nextColumnSort(config: Pick<GridConfig, "sort" | "dir" | "sortField">, column: SortableColumn): Pick<GridConfig, "sort" | "dir" | "sortField"> {
  const current = columnSortState(config, column);
  const dir: SortDir = current === "asc" ? "desc" : "asc";
  return typeof column === "number" ? { sort: "none", dir, sortField: column } : { sort: COLUMN_SORT[column], dir, sortField: null };
}

// v1.58.0 (D-354, owner: "by default when a group by is selected it should
// collapse all the group"): a chosen grouping starts folded. Sections are the
// list's own structure (a project's sections, My Tasks' sections), not a chosen
// Group by, so they stay open.
export function groupsStartFolded(group: GridGroup, groupField: number | null = null): boolean {
  return groupField !== null || (group !== "none" && group !== "section" && group !== "mySection");
}

// v1.58.0 (D-354): the sort and grouping in the address (search results), so a
// saved view keeps them. Only known values are read back.
export function gridUrlState(config: GridConfig): Record<string, string> {
  const out: Record<string, string> = {};
  if (config.sortField) out.gfield = String(config.sortField);
  else if (config.sort !== "none") out.gsort = config.sort;
  if ((config.sortField || config.sort !== "none") && config.dir === "desc") out.gdir = "desc";
  if (config.group !== "none") out.ggroup = config.group;
  return out;
}
export function gridFromUrl(query: Record<string, unknown>, base: GridConfig): GridConfig {
  const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
  const sort = String(one(query.gsort) ?? "");
  const group = String(one(query.ggroup) ?? "");
  const field = String(one(query.gfield) ?? "");
  return {
    ...base,
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as GridSort) : base.sort,
    dir: one(query.gdir) === "desc" ? "desc" : base.dir,
    sortField: /^\d{1,9}$/.test(field) && Number(field) > 0 ? Number(field) : base.sortField,
    group: (GROUPS as readonly string[]).includes(group) ? (group as GridGroup) : base.group,
  };
}

export interface GridGroupOut {
  key: string;
  name: string;
  sectionId: number | null; // set when grouped by section (adding and moving work there)
  person: string | null; // grouped by a person: their name (for the avatar)
  rows: GridTask[];
}

// Filter, sort and group the rows. `sections` keeps empty sections visible.
// v1.58.0 (D-354): `values` (a project's own fields) lets a field's column sort.
export function applyGrid(
  rows: readonly GridTask[],
  config: GridConfig,
  context: { today: string; meId: number; sections?: readonly { id: number; name: string }[]; mySections?: readonly { id: number; name: string }[]; values?: CellMap; fields?: readonly FieldView[] },
): GridGroupOut[] {
  // v1.64.0 (D-371): custom field filters (a filter on a field the view no longer has is ignored).
  const fields = new Map((context.fields ?? []).map((field) => [field.id, field]));
  const fieldFilters = (config.fieldFilters ?? []).filter((filter) => fields.has(filter.fieldId));
  const passesFields = (task: GridTask) => fieldFilters.every((filter) => matchFieldFilter(fields.get(filter.fieldId)!.kind, context.values?.[task.id]?.[filter.fieldId], filter, context.meId));
  const kept = sortGridRows(rows.filter((task) => passes(task, config, context.today, context.meId) && passesFields(task)), config, context.values);
  const byField = config.groupField ? fields.get(config.groupField) : undefined;
  if (byField) {
    const def = viewDef(byField);
    const map = new Map<string, { order: number; rows: GridTask[] }>();
    for (const task of kept)
      for (const [name, order] of fieldGroups(def, context.values?.[task.id]?.[byField.id], context.today)) {
        const entry = map.get(name) ?? { order, rows: [] };
        entry.rows.push(task);
        map.set(name, entry);
      }
    return [...map.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])).map(([name, entry]) => ({ key: `f${byField.id}:${name}`, name, sectionId: null, person: byField.kind === "PEOPLE" ? name : null, rows: entry.rows }));
  }
  if (config.group === "none") return [{ key: "all", name: "", sectionId: null, person: null, rows: kept }];
  if (config.group === "section") {
    const sections = context.sections ?? [];
    const out = sections.map((section) => ({ key: `s${section.id}`, name: section.name, sectionId: section.id, person: null, rows: kept.filter((task) => task.sectionId === section.id) }));
    const loose = kept.filter((task) => !sections.some((section) => section.id === task.sectionId));
    return loose.length ? [...out, { key: "s-none", name: "No section", sectionId: null, person: null, rows: loose }] : out;
  }
  // v1.76.0 (D-401): the person's own sections, in their own order (unless sorted).
  if (config.group === "mySection") {
    const sections = context.mySections ?? [];
    const order = (list: GridTask[]) => (config.sort === "none" && !config.sortField ? [...list].sort((a, b) => (a.myPosition ?? 0) - (b.myPosition ?? 0) || a.id - b.id) : list);
    const out = sections.map((section) => ({ key: `m${section.id}`, name: section.name, sectionId: section.id, person: null, rows: order(kept.filter((task) => task.mySectionId === section.id)) }));
    const loose = kept.filter((task) => !sections.some((section) => section.id === task.mySectionId));
    return loose.length ? [...out, { key: "m-none", name: "No section", sectionId: null, person: null, rows: loose }] : out;
  }
  const bucket = (task: GridTask): [string, number, string | null][] => {
    switch (config.group) {
      case "assignee":
        return [[personHeading(task.assigneeName, task.assigneeCode), 0, task.assigneeName]];
      case "department":
        return task.assigneeDepartment ? [[task.assigneeDepartment, 0, null]] : [["No department", 9, null]];
      case "createdBy":
        return [[personHeading(task.createdByName, task.createdByCode), 0, task.createdByName]];
      case "project":
        return task.projects.length ? task.projects.map((project) => [project.name, 0, null] as [string, number, null]) : [["No project", 9, null]];
      case "priority":
        return [[PRIORITY_NAME[task.priority], PRIORITY_RANK[task.priority], null]];
      case "kind":
        return [[task.isPeriodic ? "Periodic" : "Ad hoc", task.isPeriodic ? 0 : 1, null]];
      default: {
        if (!task.dueAt) return [["No due date", 6, null]];
        const due = indiaDay(task.dueAt);
        if (due < context.today) return [["Overdue", 0, null]];
        if (due === context.today) return [["Today", 1, null]];
        if (due <= shift(context.today, 7)) return [["Next 7 days", 2, null]];
        if (due <= shift(context.today, 30)) return [["Next 30 days", 3, null]];
        return [["Later", 4, null]];
      }
    }
  };
  const map = new Map<string, { order: number; person: string | null; rows: GridTask[] }>();
  for (const task of kept)
    for (const [name, order, person] of bucket(task)) {
      const entry = map.get(name) ?? { order, person, rows: [] };
      entry.rows.push(task);
      map.set(name, entry);
    }
  return [...map.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])).map(([name, entry]) => ({ key: `g${name}`, name, sectionId: null, person: entry.person, rows: entry.rows }));
}

// v1.78.0 (D-405): a person group's heading: "Name · EMP123" when the employee code is known.
export const personHeading = (name: string, code?: string | null) => (code ? `${name} · ${code}` : name);

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
