import { z } from "zod";
import { atLeast, effectiveProjectRole, STATUS_KINDS, type ProjectPrivacy, type ProjectRole, type ProjectStatusKind, type WorkViewer } from "@/server/work/access";

// v1.69.0 (D-382, PM phase D part 3, spec PORTFOLIOS_MODULE): the pure rules
// of portfolios: who may do what, nesting (no circles, at most 5 levels),
// roll-ups (task progress, status counts), masking of what a person can't
// see, the List's sort / filter / group, and the Timeline's quarters.
// Unit-tested; the service (server/work/portfolios.ts) applies them.

export const PORTFOLIO_LIMITS = {
  depth: 5, // levels, the top portfolio counted (spec: not documented; chosen)
  items: 500, // per portfolio (spec 1,500; chosen lower for shared hosting)
  fields: 20, // own columns per portfolio (spec 100; chosen)
  members: 200,
  options: 30, // per single-select column
  name: 150,
  description: 4000,
};

// ---- roles ---------------------------------------------------------------------------------
export interface PortfolioFacts {
  privacy: ProjectPrivacy;
  departmentId: number | null;
  defaultAccessRole: Exclude<ProjectRole, "OWNER">;
  members: readonly { id: number; role: ProjectRole }[];
}
// The same rule as projects (server/work/access.ts): the highest of the
// person's own grant and the privacy default; view for a manager whose
// reporting line has a member in it; IT acts as owner; nothing without the
// Projects module.
export function effectivePortfolioRole(portfolio: PortfolioFacts, viewer: WorkViewer): ProjectRole | null {
  return effectiveProjectRole({ privacy: portfolio.privacy, departmentId: portfolio.departmentId, defaultAccessRole: portfolio.defaultAccessRole, members: portfolio.members.map((member) => ({ type: "USER" as const, id: member.id, role: member.role })) }, viewer);
}
export function portfolioAbilities(role: ProjectRole | null) {
  return {
    view: role !== null,
    manage: atLeast(role, "OWNER"), // rename, privacy, owner, dates, archive, delete, owners
    share: atLeast(role, "EDITOR"), // add people, change non-owner roles
    edit: atLeast(role, "EDITOR"), // add and remove work, priority, columns and values, status updates, colour
  };
}
export const PORTFOLIO_ROLE_HELP: Record<ProjectRole, string> = {
  OWNER: "Everything, including privacy, people, archive and delete.",
  EDITOR: "Add and remove work, change columns and values, post status updates, add people.",
  COMMENTER: "Read only (portfolios have no comments yet).",
  VIEWER: "Read only.",
};

// ---- nesting --------------------------------------------------------------------------------
// edges: [parent portfolio, child portfolio]. A portfolio can sit in several.
export type NestingProblem = "SELF" | "CYCLE" | "DEPTH";
export const NESTING_MESSAGE: Record<NestingProblem, string> = {
  SELF: "A portfolio can't contain itself.",
  CYCLE: "That portfolio already contains this one, so it can't go inside it.",
  DEPTH: `Portfolios go at most ${PORTFOLIO_LIMITS.depth} levels deep.`,
};
function adjacency(edges: readonly (readonly [number, number])[], reverse: boolean): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const [parent, child] of edges) {
    const from = reverse ? child : parent;
    const to = reverse ? parent : child;
    map.set(from, [...(map.get(from) ?? []), to]);
  }
  return map;
}
// Everything below `id` (not `id` itself).
export function descendantsOf(edges: readonly (readonly [number, number])[], id: number): Set<number> {
  const down = adjacency(edges, false);
  const seen = new Set<number>();
  const stack = [...(down.get(id) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(down.get(next) ?? []));
  }
  return seen;
}
// Longest chain of levels through `id` in one direction, `id` counted (1 = alone).
function longest(map: Map<number, number[]>, id: number, guard = new Set<number>()): number {
  if (guard.has(id)) return Infinity; // a circle already stored: refuse anything more
  guard.add(id);
  let best = 0;
  for (const next of map.get(id) ?? []) best = Math.max(best, longest(map, next, guard));
  guard.delete(id);
  return best + 1;
}
export const levelsAbove = (edges: readonly (readonly [number, number])[], id: number) => longest(adjacency(edges, true), id);
export const levelsBelow = (edges: readonly (readonly [number, number])[], id: number) => longest(adjacency(edges, false), id);

// May `child` go inside `parent`? (BR-PORT-020; depth chosen at 5.)
export function nestingProblem(edges: readonly (readonly [number, number])[], parent: number, child: number, maxDepth = PORTFOLIO_LIMITS.depth): NestingProblem | null {
  if (parent === child) return "SELF";
  if (descendantsOf(edges, child).has(parent)) return "CYCLE";
  if (levelsAbove(edges, parent) + levelsBelow(edges, child) > maxDepth) return "DEPTH";
  return null;
}

// ---- roll-ups -------------------------------------------------------------------------------
export interface TaskCounts {
  total: number; // open + completed (cancelled and deleted tasks never count)
  completed: number;
  overdue: number;
}
export const NO_COUNTS: TaskCounts = { total: 0, completed: 0, overdue: 0 };
// Task progress (BR-PORT-008): completed / total, a whole percent cut down (4 of 6 = 66 %).
export function progressOf(counts: Pick<TaskCounts, "total" | "completed">): { percent: number; text: string } {
  const percent = counts.total > 0 ? Math.floor((counts.completed * 100) / counts.total) : 0;
  return { percent, text: counts.total ? `${counts.completed} of ${counts.total} tasks done (${percent}%)` : "No tasks yet" };
}
export function addCounts(list: readonly TaskCounts[]): TaskCounts {
  return list.reduce((sum, item) => ({ total: sum.total + item.total, completed: sum.completed + item.completed, overdue: sum.overdue + item.overdue }), { ...NO_COUNTS });
}

// The projects a portfolio rolls up for one person: its visible projects and,
// through each sub-portfolio they can see, theirs, every level, each project
// once (deny by default: a portfolio they can't see is not looked into).
export interface ItemLink {
  portfolioId: number;
  projectId: number | null;
  childId: number | null;
}
export function rolledUpProjects(rootId: number, items: readonly ItemLink[], canSeeProject: (id: number) => boolean, canSeePortfolio: (id: number) => boolean): number[] {
  const byPortfolio = new Map<number, ItemLink[]>();
  for (const item of items) byPortfolio.set(item.portfolioId, [...(byPortfolio.get(item.portfolioId) ?? []), item]);
  const projects = new Set<number>();
  const visited = new Set<number>();
  const walk = (id: number, level: number) => {
    if (visited.has(id) || level > PORTFOLIO_LIMITS.depth) return;
    visited.add(id);
    for (const item of byPortfolio.get(id) ?? []) {
      if (item.projectId !== null && canSeeProject(item.projectId)) projects.add(item.projectId);
      if (item.childId !== null && canSeePortfolio(item.childId)) walk(item.childId, level + 1);
    }
  };
  walk(rootId, 1);
  return [...projects].sort((a, b) => a - b);
}

// Progress tab: rows by their latest status (BR-PORT-009), hidden rows not counted.
export function statusCounts(statuses: readonly (ProjectStatusKind | null)[]): { onTrack: number; atRisk: number; offTrack: number; total: number } {
  return {
    onTrack: statuses.filter((status) => status === "ON_TRACK").length,
    atRisk: statuses.filter((status) => status === "AT_RISK").length,
    offTrack: statuses.filter((status) => status === "OFF_TRACK").length,
    total: statuses.length,
  };
}

// ---- rows and masking -----------------------------------------------------------------------
export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type PortfolioPriority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<PortfolioPriority, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

export interface VisibleRow {
  itemId: number;
  kind: "PROJECT" | "PORTFOLIO";
  masked: false;
  id: number; // the project's or the sub-portfolio's id
  name: string;
  color: string;
  status: ProjectStatusKind | null;
  statusAt: string | null; // ISO time of the latest status update
  counts: TaskCounts;
  startOn: string | null;
  dueOn: string | null;
  ownerId: number;
  ownerName: string;
  priority: PortfolioPriority | null;
  archived: boolean;
  projects?: number; // a sub-portfolio: how many projects it rolls up for this person
  values: Record<number, string>;
  addedByName: string;
  addedAt: string;
}
export interface MaskedRow {
  itemId: number;
  kind: "PROJECT" | "PORTFOLIO";
  masked: true;
  addedByName: string;
  addedAt: string;
}
export type PortfolioRow = VisibleRow | MaskedRow;
// What a person sees of a row they can't open: nothing but that it is there
// and who added it (spec §3.16; never its name, owner, dates or figures).
export function maskRow(row: VisibleRow): MaskedRow {
  return { itemId: row.itemId, kind: row.kind, masked: true, addedByName: row.addedByName, addedAt: row.addedAt };
}
export const maskedName = (row: Pick<MaskedRow, "kind">) => (row.kind === "PROJECT" ? "Private project" : "Private portfolio");

// ---- the List's sort, filter and group -------------------------------------------------------
export const SORTS = ["manual", "name", "status", "progress", "due", "owner", "priority"] as const;
export type PortfolioSort = (typeof SORTS)[number];
export const SORT_LABEL: Record<PortfolioSort, string> = { manual: "Order added", name: "Name", status: "Status", progress: "Task progress", due: "Due date", owner: "Owner", priority: "Priority" };
export const GROUPS = ["none", "status", "owner", "priority", "kind"] as const;
export type PortfolioGroup = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<PortfolioGroup, string> = { none: "No groups", status: "Status", owner: "Owner", priority: "Priority", kind: "Projects and portfolios" };
export const QUICK_FILTERS = ["all", "open", "closed", "mine", "offTrack", "overdue"] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number];
export const QUICK_FILTER_LABEL: Record<QuickFilter, string> = { all: "All work", open: "Incomplete work", closed: "Closed work", mine: "Just my work", offTrack: "At risk or off track", overdue: "Has overdue tasks" };

const STATUS_ORDER: (ProjectStatusKind | null)[] = ["OFF_TRACK", "AT_RISK", "ON_HOLD", "ON_TRACK", "COMPLETE", "DROPPED", null];
const CLOSED: readonly (ProjectStatusKind | null)[] = ["COMPLETE", "DROPPED"];
export function filterRows(rows: readonly PortfolioRow[], filter: QuickFilter, meId: number, query = ""): PortfolioRow[] {
  const words = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (row.masked) return filter === "all" && !words; // a hidden row matches no filter and no search
    if (words && !row.name.toLowerCase().includes(words)) return false;
    if (filter === "open") return !CLOSED.includes(row.status) && !row.archived;
    if (filter === "closed") return CLOSED.includes(row.status) || row.archived;
    if (filter === "mine") return row.ownerId === meId;
    if (filter === "offTrack") return row.status === "AT_RISK" || row.status === "OFF_TRACK";
    if (filter === "overdue") return row.counts.overdue > 0;
    return true;
  });
}
const nullsLast = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b));
export function sortRows(rows: readonly PortfolioRow[], sort: PortfolioSort, descending = false): PortfolioRow[] {
  const visible = rows.filter((row): row is VisibleRow => !row.masked);
  const hidden = rows.filter((row) => row.masked);
  if (sort === "manual") return [...rows];
  const compare = (a: VisibleRow, b: VisibleRow): number => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "status") return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (sort === "progress") return progressOf(a.counts).percent - progressOf(b.counts).percent;
    if (sort === "due") return nullsLast(a.dueOn, b.dueOn);
    if (sort === "owner") return a.ownerName.localeCompare(b.ownerName);
    return (a.priority ? PRIORITIES.indexOf(a.priority) : 9) - (b.priority ? PRIORITIES.indexOf(b.priority) : 9);
  };
  const sorted = [...visible].sort((a, b) => compare(a, b) * (descending ? -1 : 1) || a.name.localeCompare(b.name));
  return [...sorted, ...hidden]; // hidden rows always last
}
export function groupRows(rows: readonly PortfolioRow[], group: PortfolioGroup, statusLabel: (status: ProjectStatusKind) => string): { key: string; label: string; rows: PortfolioRow[] }[] {
  if (group === "none") return [{ key: "all", label: "", rows: [...rows] }];
  const groups = new Map<string, { key: string; label: string; rows: PortfolioRow[] }>();
  const keyOf = (row: PortfolioRow): [string, string] => {
    if (row.masked) return ["~hidden", "Work you can't see"];
    if (group === "status") return row.status ? [`${STATUS_ORDER.indexOf(row.status)}`, statusLabel(row.status)] : ["9", "No recent updates"];
    if (group === "owner") return [`o${row.ownerName}`, row.ownerName];
    if (group === "kind") return row.kind === "PROJECT" ? ["1", "Projects"] : ["2", "Portfolios"];
    return row.priority ? [`${PRIORITIES.indexOf(row.priority)}`, PRIORITY_LABEL[row.priority]] : ["9", "No priority"];
  };
  for (const row of rows) {
    const [key, label] = keyOf(row);
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // code-point order: "~hidden" last
}

// ---- own columns (fields) -------------------------------------------------------------------
export const FIELD_KINDS = ["TEXT", "NUMBER", "SELECT", "DATE", "PEOPLE"] as const;
export type PortfolioFieldKind = (typeof FIELD_KINDS)[number];
export const FIELD_KIND_LABEL: Record<PortfolioFieldKind, string> = { TEXT: "Text", NUMBER: "Number", SELECT: "Single-select", DATE: "Date", PEOPLE: "Person" };
export const fieldInputSchema = z.object({
  name: z.string().trim().min(1, "Give the column a name.").max(80, "At most 80 characters."),
  kind: z.enum(FIELD_KINDS),
  options: z.array(z.string().trim().min(1).max(60)).max(PORTFOLIO_LIMITS.options).default([]),
});
// A value for a column: the stored text, or an error. Empty clears it (null).
export function checkFieldValue(field: { kind: PortfolioFieldKind; options: readonly string[] }, raw: unknown, isPerson: (id: number) => boolean): { ok: true; value: string | null } | { ok: false; message: string } {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : raw === null || raw === undefined ? "" : null;
  if (text === null) return { ok: false, message: "That value isn't valid." };
  if (text === "") return { ok: true, value: null };
  if (field.kind === "TEXT") return text.length > 500 ? { ok: false, message: "At most 500 characters." } : { ok: true, value: text };
  if (field.kind === "NUMBER") {
    if (!/^-?\d{1,12}(\.\d{1,4})?$/.test(text)) return { ok: false, message: "Enter a number (up to 4 decimals)." };
    return { ok: true, value: String(Number(text)) };
  }
  if (field.kind === "SELECT") return field.options.includes(text) ? { ok: true, value: text } : { ok: false, message: "Choose one of the column's options." };
  if (field.kind === "DATE") return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) ? { ok: true, value: text } : { ok: false, message: "Enter a date." };
  return /^\d{1,10}$/.test(text) && isPerson(Number(text)) ? { ok: true, value: text } : { ok: false, message: "Choose an active person." };
}

// ---- status updates -------------------------------------------------------------------------
export const statusInputSchema = z.object({
  status: z.enum(STATUS_KINDS, { message: "Pick a status." }),
  title: z.string().trim().max(200).default(""),
  body: z.string().trim().max(4000).default(""),
});
// BR-PORT-016: a status and some words (a headline or a summary).
export function statusProblem(input: { title: string; body: string }): string | null {
  return input.title.trim() || input.body.replace(/<[^>]*>/g, "").trim() ? null : "Pick a status and add a headline or a summary before posting.";
}

// ---- Timeline (quarters) --------------------------------------------------------------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export interface Quarter {
  key: string; // 2027-Q1
  label: string; // Q1 2027
  months: string; // Jan–Mar
  start: string; // first day
  end: string; // last day
}
export function quarterOf(day: string): { year: number; q: number } {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return { year, q: Math.floor((month - 1) / 3) + 1 };
}
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export function quarter(year: number, q: number): Quarter {
  const first = (q - 1) * 3 + 1;
  return { key: `${year}-Q${q}`, label: `Q${q} ${year}`, months: `${MONTHS[first - 1]}–${MONTHS[first + 1]}`, start: `${year}-${pad(first)}-01`, end: `${year}-${pad(first + 2)}-${pad(lastDay(year, first + 2))}` };
}
// `count` quarters from the one holding `day`, moved by `offset` quarters.
export function quarterWindow(day: string, offset: number, count = 4): Quarter[] {
  const { year, q } = quarterOf(day);
  const index0 = year * 4 + (q - 1) + offset;
  return Array.from({ length: count }, (_, i) => quarter(Math.floor((index0 + i) / 4), ((index0 + i) % 4) + 1));
}
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
// Where a bar sits in the window, in percent of its width (null: outside it
// or no dates). A missing start uses the due date and the reverse (a marker).
export function barPlacement(startOn: string | null, dueOn: string | null, window: readonly Quarter[]): { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null {
  if (!window.length || (!startOn && !dueOn)) return null;
  const from = startOn ?? dueOn!;
  const to = dueOn && dueOn >= from ? dueOn : from;
  const begin = dayNumber(window[0]!.start);
  const finish = dayNumber(window[window.length - 1]!.end) + 1;
  const a = dayNumber(from);
  const b = dayNumber(to) + 1;
  if (b <= begin || a >= finish) return null;
  const span = finish - begin;
  const left = Math.max(a, begin);
  const right = Math.min(b, finish);
  return { left: ((left - begin) / span) * 100, width: Math.max(((right - left) / span) * 100, 0.6), clippedStart: a < begin, clippedEnd: b > finish };
}
