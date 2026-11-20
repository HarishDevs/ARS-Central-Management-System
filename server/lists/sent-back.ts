import { compareValues, parseColumnSort, sortRows, type ColumnSort } from "@/server/lists/sorting";
import { departmentBucket, indiaDayOf, pickGroup } from "@/server/lists/group-rows";
import type { ShownPriority } from "@/server/approvals/priority";

// v1.59.1 (owner: "Sent back for changes: this i dont want as a seperate table
// … Give me a seperate page with table format with all the table related
// features we used so far"): the Sent back for changes page. Search, filters,
// sort on every column, Group by (folded), saved views and pages, like the
// other lists. One approver's sent-back requests are few (at most 500 are
// read), so the page filters, sorts and groups them on the server. Pure.

export interface SentBackRow {
  requestId: number;
  requestNo: string;
  title: string;
  requesterName: string;
  nodeLabel: string;
  sentAt: Date;
  reason: string | null;
  typeName: string;
  forName: string | null;
  departmentName: string | null;
}

export const SENT_BACK_COLUMNS = ["request", "type", "priority", "requester", "department", "step", "sent", "waiting", "reason"] as const;
export type SentBackColumn = (typeof SENT_BACK_COLUMNS)[number];
export const SENT_BACK_GROUPS = ["dept", "requester", "type", "step", "priority", "month"] as const;
export type SentBackGroup = (typeof SENT_BACK_GROUPS)[number];
export const SENT_BACK_GROUP_LABEL: Record<SentBackGroup, string> = { dept: "Department", requester: "Requester", type: "Approval type", step: "Your step", priority: "Priority", month: "Month sent back" };
export const SENT_BACK_PAGE_SIZE = 50;

export interface SentBackFilter {
  q: string;
  type: string;
  requester: string;
  dept: string;
  step: string;
  from: string; // sent back on or after (India day, YYYY-MM-DD)
  to: string;
  group: SentBackGroup | null;
  sort: ColumnSort<SentBackColumn>;
  page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (value: unknown, max = 100) => (typeof (Array.isArray(value) ? value[0] : value) === "string" ? String(Array.isArray(value) ? value[0] : value).trim().slice(0, max) : "");

export function parseSentBackFilter(query: Record<string, unknown>): SentBackFilter {
  const day = (key: string) => (DAY.test(text(query[key], 10)) ? text(query[key], 10) : "");
  return {
    q: text(query.q),
    type: text(query.type, 150),
    requester: text(query.requester, 150),
    dept: text(query.dept, 150),
    step: text(query.step, 200),
    from: day("from"),
    to: day("to"),
    group: pickGroup(query.group, SENT_BACK_GROUPS),
    // Newest sent back first until a column is chosen.
    sort: parseColumnSort(query, SENT_BACK_COLUMNS, { sortBy: "sent", dir: "desc" }),
    page: Math.max(1, Math.min(1000, Math.floor(Number(text(query.page, 6))) || 1)),
  };
}

export const filterCount = (filter: SentBackFilter) => [filter.type, filter.requester, filter.dept, filter.step, filter.from || filter.to].filter(Boolean).length;

// Whole days the request has been back with the requester.
export const daysWaiting = (row: SentBackRow, now: Date) => Math.max(0, Math.floor((now.getTime() - row.sentAt.getTime()) / 86_400_000));

const rankOf = (priority: ShownPriority | undefined) => (priority && !priority.hidden ? priority.rank : null);

export function applySentBack(rows: readonly SentBackRow[], filter: SentBackFilter, priority: Record<number, ShownPriority>, now: Date): SentBackRow[] {
  const q = filter.q.toLowerCase();
  const kept = rows.filter((row) => {
    if (q && ![row.requestNo, row.title, row.requesterName, row.reason ?? ""].some((value) => value.toLowerCase().includes(q))) return false;
    if (filter.type && row.typeName !== filter.type) return false;
    if (filter.requester && row.requesterName !== filter.requester) return false;
    if (filter.dept && (row.departmentName ?? "") !== filter.dept) return false;
    if (filter.step && row.nodeLabel !== filter.step) return false;
    const day = indiaDayOf(row.sentAt);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    return true;
  });
  const value = (row: SentBackRow): unknown => {
    switch (filter.sort.sortBy) {
      case "request":
        return row.title;
      case "type":
        return row.typeName;
      case "priority":
        return rankOf(priority[row.requestId]);
      case "requester":
        return row.requesterName;
      case "department":
        return row.departmentName;
      case "step":
        return row.nodeLabel;
      case "waiting":
        return daysWaiting(row, now);
      case "reason":
        return row.reason;
      default:
        return row.sentAt;
    }
  };
  return sortRows(kept, value, filter.sort.dir);
}

// The group heading and its order for one row.
export function sentBackBucket(group: SentBackGroup, row: SentBackRow, priority: Record<number, ShownPriority>): [string, number] {
  switch (group) {
    case "dept":
      return departmentBucket(row.departmentName);
    case "requester":
      return [row.requesterName, 0];
    case "type":
      return [row.typeName, 0];
    case "step":
      return [row.nodeLabel, 0];
    case "priority": {
      const shown = priority[row.requestId];
      return shown && !shown.hidden ? [shown.label, shown.rank] : ["No priority", Number.MAX_SAFE_INTEGER];
    }
    default: {
      const month = indiaDayOf(row.sentAt).slice(0, 7);
      return [month, -Number(month.replace("-", ""))];
    }
  }
}

// The choices for the filters, from the rows themselves (nothing else is revealed).
export function sentBackChoices(rows: readonly SentBackRow[]) {
  const distinct = (values: (string | null)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => compareValues(a, b));
  return {
    types: distinct(rows.map((row) => row.typeName)),
    requesters: distinct(rows.map((row) => row.requesterName)),
    departments: distinct(rows.map((row) => row.departmentName)),
    steps: distinct(rows.map((row) => row.nodeLabel)),
  };
}
