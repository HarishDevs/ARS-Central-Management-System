import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool, type Queryable } from "@/lib/db/client";
import type { TicketPriority } from "@/server/modules/settings";
import type { TicketStatus } from "@/server/tickets/rules";

// v1.56.0 (D-334, owner: "in the Analytics page the coordinators can see only
// their ticketing's dashboard; it should also work as an access based"): the
// tickets the Ticket analytics board counts.
//  - all: IT (Whole organisation): every ticket.
//  - otherwise: tickets raised by or assigned to the people in the chosen
//    scope (me; my reporting line; my departments), plus every ticket of the
//    forms the viewer coordinates.
export type TicketAnalyticsScope = { all: true } | { all: false; peopleIds: number[]; viewerId: number; categoryIds?: number[] };

export interface AnalyticsTicket {
  id: number;
  ticketNo: string;
  title: string;
  // v1.59.2 (D-360): for "Status by department" (one table per form, a row per department).
  categoryId: number;
  categoryPosition: number;
  categoryName: string;
  typeId: number; // v1.59.4: the form (ticket type), for a table per form
  typeName: string;
  priority: TicketPriority;
  status: TicketStatus;
  closeKind: string | null;
  departmentId: number | null;
  departmentName: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  submittedAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  dueAt: Date | null;
  requiredOn: string | null; // YYYY-MM-DD, the requester's Required date
  reopenCount: number;
  rating: number | null;
}

type Row = RowDataPacket & Record<string, unknown>;
const date = (value: unknown) => (value ? new Date(value as string) : null);

function scopeSql(scope: TicketAnalyticsScope): { sql: string; params: unknown[] } {
  if (scope.all) return { sql: "1 = 1", params: [] };
  const people = scope.peopleIds.length ? scope.peopleIds : [scope.viewerId];
  // v1.57.1 (D-338): plus the categories the viewer was named for in Admin.
  const categories = scope.categoryIds?.length ? scope.categoryIds : null;
  return {
    sql: `(k.requester_id IN (?) OR k.assignee_id IN (?) OR v.type_id IN (SELECT type_id FROM ticket_coordinators WHERE user_id = ?)${categories ? " OR k.category_id IN (?)" : ""})`,
    params: [people, people, scope.viewerId, ...(categories ? [categories] : [])],
  };
}
const FROM = `FROM tickets k JOIN module_type_versions v ON v.id = k.type_version_id JOIN module_types t ON t.id = v.type_id JOIN ticket_categories c ON c.id = k.category_id
  LEFT JOIN users a ON a.id = k.assignee_id LEFT JOIN departments d ON d.id = k.requester_department_id`;
const SELECT = `SELECT k.id, k.ticket_no, k.title, k.category_id, c.position AS category_position, c.name AS category_name, t.id AS type_id, t.name AS type_name, k.priority, k.status, k.close_kind, k.requester_department_id, d.name AS department_name,
  k.assignee_id, a.name AS assignee_name, k.submitted_at, k.first_response_at, k.resolved_at, k.closed_at, k.due_at, DATE_FORMAT(k.required_on, '%Y-%m-%d') AS required_on, k.reopen_count,
  (SELECT f.rating FROM ticket_feedback f WHERE f.ticket_id = k.id ORDER BY f.cycle DESC LIMIT 1) AS rating`;

const toTicket = (row: Row): AnalyticsTicket => ({
  id: Number(row.id),
  ticketNo: String(row.ticket_no),
  title: String(row.title),
  categoryId: Number(row.category_id),
  categoryPosition: Number(row.category_position ?? 0),
  categoryName: String(row.category_name),
  typeId: Number(row.type_id),
  typeName: String(row.type_name),
  priority: String(row.priority) as TicketPriority,
  status: String(row.status) as TicketStatus,
  closeKind: row.close_kind ? String(row.close_kind) : null,
  departmentId: row.requester_department_id === null || row.requester_department_id === undefined ? null : Number(row.requester_department_id),
  departmentName: row.department_name ? String(row.department_name) : null,
  assigneeId: row.assignee_id === null || row.assignee_id === undefined ? null : Number(row.assignee_id),
  assigneeName: row.assignee_name ? String(row.assignee_name) : null,
  submittedAt: new Date(row.submitted_at as string),
  firstResponseAt: date(row.first_response_at),
  resolvedAt: date(row.resolved_at),
  closedAt: date(row.closed_at),
  dueAt: date(row.due_at),
  requiredOn: row.required_on ? String(row.required_on) : null,
  reopenCount: Number(row.reopen_count ?? 0),
  rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
});

// Tickets raised in [from, to).
export async function analyticsTickets(scope: TicketAnalyticsScope, from: Date, to: Date, db: Queryable = getDbPool()): Promise<AnalyticsTicket[]> {
  const visible = scopeSql(scope);
  const [rows] = await db.query<Row[]>(`${SELECT} ${FROM} WHERE k.submitted_at >= ? AND k.submitted_at < ? AND ${visible.sql} ORDER BY k.id LIMIT 20000`, [from, to, ...visible.params]);
  return rows.map(toTicket);
}

// Every ticket still open now (whenever it was raised).
export async function openTicketsInScope(scope: TicketAnalyticsScope, db: Queryable = getDbPool()): Promise<AnalyticsTicket[]> {
  const visible = scopeSql(scope);
  const [rows] = await db.query<Row[]>(`${SELECT} ${FROM} WHERE k.status <> 'CLOSED' AND ${visible.sql} ORDER BY k.id LIMIT 20000`, visible.params);
  return rows.map(toTicket);
}

// Raised and closed per month (India time), from `since`.
export async function ticketMonths(scope: TicketAnalyticsScope, since: Date, db: Queryable = getDbPool()): Promise<{ month: string; raised: number; closed: number; autoClosed: number }[]> {
  const visible = scopeSql(scope);
  const [rows] = await db.query<Row[]>(
    `SELECT m.month, SUM(m.raised) AS raised, SUM(m.closed) AS closed, SUM(m.auto_closed) AS auto_closed FROM (
       SELECT DATE_FORMAT(k.submitted_at + INTERVAL 330 MINUTE, '%Y-%m') AS month, 1 AS raised, 0 AS closed, 0 AS auto_closed ${FROM} WHERE k.submitted_at >= ? AND ${visible.sql}
       UNION ALL
       SELECT DATE_FORMAT(k.closed_at + INTERVAL 330 MINUTE, '%Y-%m'), 0, 1, IF(k.close_kind = 'AUTO', 1, 0) ${FROM} WHERE k.closed_at IS NOT NULL AND k.closed_at >= ? AND ${visible.sql}
     ) m GROUP BY m.month ORDER BY m.month`,
    [since, ...visible.params, since, ...visible.params],
  );
  return rows.map((row) => ({ month: String(row.month), raised: Number(row.raised), closed: Number(row.closed), autoClosed: Number(row.auto_closed) }));
}
