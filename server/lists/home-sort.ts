import { nextDir, parseColumnSort, sortHref, sortRows, type ColumnSort, type SortDir } from "@/server/lists/sorting";
import type { ShownPriority } from "@/server/approvals/priority";

// v1.58.1 (owner: "request's form Priority is a must sortable column in all
// tables"): the Home widgets (Waiting for me, Due soon or overdue, Returned to
// you, My recent requests) sort on every column, Priority included. Home has
// several tables, so each one's columns carry a prefix in the one ?sortBy=
// (e.g. hq.priority), as the meeting tables on Home do. Pure.
export const HOME_QUEUE_COLUMNS = ["title", "priority", "from", "step", "since", "due"] as const;
export const HOME_MINE_COLUMNS = ["title", "type", "status", "priority", "waiting", "raised"] as const;
export type HomeQueueColumn = (typeof HOME_QUEUE_COLUMNS)[number];
export type HomeMineColumn = (typeof HOME_MINE_COLUMNS)[number];

export interface HomeTableSort<K extends string> {
  sortBy: K | null;
  dir: SortDir;
  hrefs: Record<string, string>;
}

// The sort of one Home table (prefix e.g. "hq") and the address of each column title.
export function homeTableSort<K extends string>(query: Record<string, unknown>, prefix: string, columns: readonly K[]): HomeTableSort<K> {
  const keys = columns.map((column) => `${prefix}.${column}`);
  const parsed = parseColumnSort(query, keys);
  const sortBy = parsed.sortBy ? (parsed.sortBy.slice(prefix.length + 1) as K) : null;
  const current: ColumnSort = { sortBy: parsed.sortBy, dir: parsed.dir };
  const hrefs: Record<string, string> = {};
  for (const column of columns) hrefs[column] = sortHref("/users", query, `${prefix}.${column}`, nextDir(current, `${prefix}.${column}`));
  return { sortBy, dir: parsed.dir, hrefs };
}

// A request's priority for sorting: its option's place (0 = first, e.g. Critical); none or hidden = empty (last).
const priorityRank = (priority: ShownPriority | undefined): number | null => (priority && !priority.hidden ? priority.rank : null);

interface QueueLike {
  requestId: number;
  title: string;
  requesterName: string;
  nodeLabel: string;
  createdAt: Date;
  dueAt: Date | null;
}
export function sortQueueItems<T extends QueueLike>(items: readonly T[], sort: { sortBy: HomeQueueColumn | null; dir: SortDir }, priority: Record<number, ShownPriority>): T[] {
  if (!sort.sortBy) return [...items];
  const value = (item: T): unknown => {
    switch (sort.sortBy) {
      case "title":
        return item.title;
      case "priority":
        return priorityRank(priority[item.requestId]);
      case "from":
        return item.requesterName;
      case "step":
        return item.nodeLabel;
      case "since":
        return item.createdAt;
      default:
        return item.dueAt;
    }
  };
  return sortRows(items, value, sort.dir);
}

interface MineLike {
  id: number;
  title: string;
  workflowName: string;
  status: string;
  submittedAt: Date;
  pendingWith: string | null;
}
export function sortMyRequests<T extends MineLike>(items: readonly T[], sort: { sortBy: HomeMineColumn | null; dir: SortDir }, priority: Record<number, ShownPriority>): T[] {
  if (!sort.sortBy) return [...items];
  const value = (item: T): unknown => {
    switch (sort.sortBy) {
      case "title":
        return item.title;
      case "type":
        return item.workflowName;
      case "status":
        return item.status;
      case "priority":
        return priorityRank(priority[item.id]);
      case "waiting":
        return item.status === "IN_PROGRESS" || item.status === "ON_HOLD" ? item.pendingWith : null;
      default:
        return item.submittedAt;
    }
  };
  return sortRows(items, value, sort.dir);
}
