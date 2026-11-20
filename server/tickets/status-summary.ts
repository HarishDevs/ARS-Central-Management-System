import { TICKET_PRIORITIES, type TicketPriority } from "@/server/modules/settings";

// v1.59.2 (D-360, owner: "Priority wise IT Software Issues Status"): the
// "Status by department" tables of the Ticket analytics board. One table per
// ticket form (category), a row per requester's department, and a Total row.
// Pure: no database, no React.
//
// The owner's rules:
//  - Due = the coordinator's Target date (due_at) when set; otherwise the
//    requester's Required date (required_on), due by the end of that India day.
//    Neither = no due date.
//  - Finished = closed (closed_at), not resolved.
//  - Closed, and no due date or closed by the due = On time. Closed after the due = Delay.
//  - Not closed and the due has passed = Overdue. Otherwise (due not passed, or no due date) = Not due.

export type TicketTimeliness = "ON_TIME" | "DELAY" | "OVERDUE" | "NOT_DUE";
export type PriorityFilter = "ALL" | TicketPriority;

export interface TimelinessFacts {
  dueAt: Date | null;
  requiredOn: string | null; // YYYY-MM-DD (India date)
  closedAt: Date | null;
  // A reopened ticket keeps its old closed_at: it counts as closed only while its status is CLOSED.
  status?: string;
}

export interface StatusSummaryTicket extends TimelinessFacts {
  categoryId: number;
  categoryName: string;
  categoryPosition?: number;
  // v1.59.4 (owner: "i want the seperate ticketing, or whatever forms created"): the form.
  typeId?: number;
  typeName?: string;
  departmentId: number | null;
  departmentName: string | null;
  priority: TicketPriority;
}

export interface StatusCounts {
  total: number;
  onTime: number;
  delay: number;
  overdue: number;
  notDue: number;
}

export interface StatusRow extends StatusCounts {
  departmentId: number | null; // null = Others
  department: string;
}

export interface StatusTable {
  key: string; // "c<category id>" (a category's forms together) or "t<form id>"
  scope: "CATEGORY" | "FORM";
  title: string; // the form's name, or "<category> (all forms)"
  categoryId: number;
  categoryName: string;
  rows: StatusRow[]; // by department name; Others last
  total: StatusCounts;
}

export const OTHERS = "Others";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// The end of an India day (UTC+5:30): 23:59:59.999 IST.
export function endOfIndiaDay(day: string): Date | null {
  if (!ISO_DAY.test(day)) return null;
  const end = new Date(`${day}T23:59:59.999+05:30`);
  return Number.isNaN(end.getTime()) ? null : end;
}

// The ticket's due moment: the Target date wins over the Required date.
export function ticketDue(ticket: Pick<TimelinessFacts, "dueAt" | "requiredOn">): Date | null {
  if (ticket.dueAt) return ticket.dueAt;
  return ticket.requiredOn ? endOfIndiaDay(ticket.requiredOn) : null;
}

export function classifyTicket(ticket: TimelinessFacts, now: Date = new Date()): TicketTimeliness {
  const due = ticketDue(ticket);
  if (ticket.closedAt && (ticket.status === undefined || ticket.status === "CLOSED")) return !due || ticket.closedAt.getTime() <= due.getTime() ? "ON_TIME" : "DELAY";
  return due && now.getTime() > due.getTime() ? "OVERDUE" : "NOT_DUE";
}

// The ?tpriority= value: one of the five priorities, else All.
export function parsePriorityFilter(value: string | null | undefined): PriorityFilter {
  return (TICKET_PRIORITIES as readonly string[]).includes(value ?? "") ? (value as TicketPriority) : "ALL";
}

const emptyCounts = (): StatusCounts => ({ total: 0, onTime: 0, delay: 0, overdue: 0, notDue: 0 });
const KEY: Record<TicketTimeliness, keyof Omit<StatusCounts, "total">> = { ON_TIME: "onTime", DELAY: "delay", OVERDUE: "overdue", NOT_DUE: "notDue" };

function add(counts: StatusCounts, kind: TicketTimeliness) {
  counts.total += 1;
  counts[KEY[kind]] += 1;
}

// v1.59.4 (D-363, owner: "i want the seperate ticketing, or whatever forms
// created and i want whatever category generated"): one table per form
// (ticket type) that has at least one ticket in the period, under its
// category; a category with two or more such forms first gets a table of all
// its forms together. Rows use tickets at any priority, so the tables and
// their department rows stay the same when the priority changes (a department
// with none at the chosen priority shows zeros). Categories in their Admin
// order, then by name; forms by name.
type Bucket = { departments: Map<number | null, StatusRow> };

function tally(bucket: Bucket, ticket: StatusSummaryTicket, priority: PriorityFilter, now: Date) {
  const departmentId = ticket.departmentId ?? null;
  const row = bucket.departments.get(departmentId) ?? { departmentId, department: departmentId === null ? OTHERS : (ticket.departmentName ?? OTHERS), ...emptyCounts() };
  bucket.departments.set(departmentId, row);
  if (priority === "ALL" || ticket.priority === priority) add(row, classifyTicket(ticket, now));
}

function finish(bucket: Bucket): { rows: StatusRow[]; total: StatusCounts } {
  const rows = [...bucket.departments.values()].sort((a, b) => {
    if ((a.departmentId === null) !== (b.departmentId === null)) return a.departmentId === null ? 1 : -1;
    return a.department.localeCompare(b.department, "en-IN", { sensitivity: "base" }) || (a.departmentId ?? 0) - (b.departmentId ?? 0);
  });
  const total = emptyCounts();
  for (const row of rows) {
    total.total += row.total;
    total.onTime += row.onTime;
    total.delay += row.delay;
    total.overdue += row.overdue;
    total.notDue += row.notDue;
  }
  return { rows, total };
}

export function summariseStatusByDepartment(tickets: readonly StatusSummaryTicket[], priority: PriorityFilter = "ALL", now: Date = new Date()): StatusTable[] {
  const categories = new Map<number, Bucket & { name: string; position: number; forms: Map<number, Bucket & { name: string }> }>();
  for (const ticket of tickets) {
    const category = categories.get(ticket.categoryId) ?? { name: ticket.categoryName, position: ticket.categoryPosition ?? 0, departments: new Map(), forms: new Map() };
    categories.set(ticket.categoryId, category);
    tally(category, ticket, priority, now);
    const formId = ticket.typeId ?? -ticket.categoryId;
    const form = category.forms.get(formId) ?? { name: ticket.typeName ?? ticket.categoryName, departments: new Map() };
    category.forms.set(formId, form);
    tally(form, ticket, priority, now);
  }
  const tables: StatusTable[] = [];
  for (const [categoryId, category] of [...categories.entries()].sort(([, a], [, b]) => a.position - b.position || a.name.localeCompare(b.name, "en-IN"))) {
    const forms = [...category.forms.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name, "en-IN"));
    if (forms.length > 1) tables.push({ key: `c${categoryId}`, scope: "CATEGORY", title: `${category.name} (all forms)`, categoryId, categoryName: category.name, ...finish(category) });
    for (const [formId, form] of forms) tables.push({ key: `t${formId}`, scope: "FORM", title: form.name, categoryId, categoryName: category.name, ...finish(form) });
  }
  return tables;
}
