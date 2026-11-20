// D-191 (owner): the Admin "records" registers: every approval request, task
// and information item, whoever raised it, in one spreadsheet-like table each.
// This file reads the filters from the address (pure, unit-tested); every
// value is checked against a fixed list or pattern before it reaches SQL.
import { priorityRankSql } from "@/server/approvals/priority";

export type RecordKind = "requests" | "tasks" | "information";

export const REQUEST_STATUSES = ["IN_PROGRESS", "ON_HOLD", "CHANGES_REQUIRED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"] as const;
export const INFO_STATUSES = ["DRAFT", "PUBLISHED", "WITHDRAWN", "ARCHIVED"] as const;
export const TASK_PRIORITIES = ["URGENT", "HIGH", "IMPORTANT", "ELEVATED", "NORMAL", "LOW"] as const; // v1.50.1: IMPORTANT added; v1.55.1: ELEVATED ("High")
export const INFO_PRIORITIES = ["NORMAL", "ELEVATED", "IMPORTANT", "HIGH", "URGENT"] as const;

// The sortable columns of each register (column key → SQL expression).
export const SORTS: Record<RecordKind, Record<string, string>> = {
  requests: { no: "r.id", title: "r.title", type: "type_name", raisedBy: "requester_name", department: "department_name", status: "r.status", submitted: "r.submitted_at", closed: "r.closed_at" },
  tasks: { no: "t.id", title: "t.title", type: "type_name", priority: "FIELD(t.priority, 'LOW', 'NORMAL', 'ELEVATED', 'IMPORTANT', 'HIGH', 'URGENT')", status: "t.status", assignee: "assignee_name", department: "department_name", created: "t.created_at", due: "t.due_at", completed: "t.completed_at" },
  information: { no: "i.id", title: "i.title", type: "type_name", priority: "FIELD(i.priority, 'NORMAL', 'ELEVATED', 'IMPORTANT', 'HIGH', 'URGENT')", status: "i.status", createdBy: "creator_name", department: "department_name", created: "i.created_at", published: "i.published_at" },
};
// v1.58.0 (D-354, owner: "sorting ... in all columns"): the remaining columns.
// Amount is not sortable: it is read from each request's form and may be
// confidential (sorting would give hidden values away).
// v1.58.1 (owner: "request's form Priority is a must sortable column in all
// tables"): Priority sorts by its option's place in the form (first option,
// e.g. Critical, first on ascending), as on the user lists. A confidential
// Priority ranks as empty (always last), so the order gives nothing away.
Object.assign(SORTS.requests, { priority: priorityRankSql("r", "v"), step: "current_step", waiting: "waiting_on", approvals: "approvals", round: "r.round", age: "TIMESTAMPDIFF(SECOND, r.submitted_at, COALESCE(r.closed_at, UTC_TIMESTAMP()))" });
Object.assign(SORTS.tasks, { overdue: "overdue", assignedBy: "assigned_by_name", related: "related_request" });
Object.assign(SORTS.information, { effective: "i.effective_on", expires: "i.expires_on", recipients: "recipients", read: "read_count", ack: "ack_count" });

// v1.58.0 (D-354, owner): Group by. A grouped page is ordered by the group
// first (then the column sort), so each group's rows stay together.
export const RECORD_GROUPS: Record<RecordKind, readonly { key: string; label: string }[]> = {
  requests: [
    { key: "department", label: "Department" },
    { key: "status", label: "Status" },
    { key: "type", label: "Approval type" },
    { key: "month", label: "Month submitted" },
  ],
  tasks: [
    { key: "department", label: "Department" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "type", label: "Task type" },
    { key: "month", label: "Month created" },
  ],
  information: [
    { key: "department", label: "Department" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "type", label: "Information type" },
    { key: "month", label: "Month created" },
  ],
};
const ALIAS: Record<RecordKind, string> = { requests: "r", tasks: "t", information: "i" };
export function recordGroupSql(kind: RecordKind, group: string): string | null {
  const alias = ALIAS[kind];
  if (group === "department") return "(d.name IS NULL), d.name";
  if (group === "status") return `${alias}.status`;
  if (group === "type") return "type_name";
  if (group === "month") return `${kind === "requests" ? "r.submitted_at" : `${alias}.created_at`} DESC`;
  if (group === "priority" && kind !== "requests") return `${SORTS[kind].priority} DESC`;
  return null;
}

export interface RecordFilter {
  q: string;
  status: string;
  type: number | null;
  department: number | null;
  person: number | null; // requests: raised by; tasks: assignee; information: created by
  waitingOn: number | null; // requests only
  priority: string;
  overdue: boolean; // tasks only
  from: string | null; // India dates, YYYY-MM-DD
  to: string | null;
  sort: string;
  dir: "asc" | "desc";
  group: string | null; // v1.58.0 (D-354): a key of RECORD_GROUPS
  page: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const id = (value: string | undefined) => (value && /^\d{1,12}$/.test(value) ? Number(value) : null);
const oneOf = (value: string | undefined, list: readonly string[]) => (value && list.includes(value) ? value : "");

export function readRecordFilter(kind: RecordKind, query: Record<string, string | undefined>): RecordFilter {
  const statuses = kind === "requests" ? REQUEST_STATUSES : kind === "tasks" ? TASK_STATUSES : INFO_STATUSES;
  const priorities = kind === "tasks" ? TASK_PRIORITIES : kind === "information" ? INFO_PRIORITIES : [];
  const from = query.from && DAY.test(query.from) ? query.from : null;
  const to = query.to && DAY.test(query.to) ? query.to : null;
  const sort = query.sort && query.sort in SORTS[kind] ? query.sort : "no";
  return {
    q: (query.q ?? "").trim().slice(0, 100),
    status: oneOf(query.status, statuses),
    type: id(query.type),
    department: id(query.department),
    person: id(query.person),
    waitingOn: kind === "requests" ? id(query.waiting) : null,
    priority: oneOf(query.priority, priorities),
    overdue: kind === "tasks" && query.overdue === "1",
    from,
    to: from && to && to < from ? from : to,
    sort,
    dir: query.dir === "asc" ? "asc" : "desc",
    group: RECORD_GROUPS[kind].some((choice) => choice.key === query.group) ? query.group! : null,
    page: Math.max(1, Math.min(100_000, Number(query.page) || 1)),
  };
}

// The address of the same register with some filters changed (links, paging, sorting).
export function recordQuery(filter: RecordFilter, changes: Partial<Record<string, string | number | null>> = {}): string {
  const values: Record<string, string | number | null> = {
    q: filter.q || null,
    status: filter.status || null,
    type: filter.type,
    department: filter.department,
    person: filter.person,
    waiting: filter.waitingOn,
    priority: filter.priority || null,
    overdue: filter.overdue ? "1" : null,
    from: filter.from,
    to: filter.to,
    sort: filter.sort === "no" ? null : filter.sort,
    dir: filter.dir === "desc" ? null : filter.dir,
    group: filter.group ?? null,
    page: filter.page > 1 ? filter.page : null,
    ...changes,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

// India date (YYYY-MM-DD) → the UTC instant its day starts.
export const indiaDayStartUtc = (day: string): Date => new Date(Date.parse(`${day}T00:00:00Z`) - 330 * 60_000);
export const nextIndiaDayStartUtc = (day: string): Date => new Date(indiaDayStartUtc(day).getTime() + 86_400_000);

export const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
