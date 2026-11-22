import "server-only";
import { isAdminActor } from "@/server/modules/tasks";
import { listTickets, viewerCategories } from "@/lib/db/repositories/tickets.repository";
import { listMeetings } from "@/lib/db/repositories/meetings.repository";
import { scopeFor } from "@/server/meetings/service";
import { TICKET_STATUS_LABEL } from "@/server/tickets/rules";

// v1.72.1 (D-395, QA F-08): Ctrl+K also finds tickets and meetings, by
// number or title, with the same visibility as their lists: tickets the
// person raised, is assigned or coordinates (or sees by category, or all for
// IT); meetings they are on, their departments' (HOD), or all for IT and
// Management. Callers check the module and page access first.
type Actor = { id: number; roles: readonly string[]; modules?: readonly string[] };
export type QuickTicket = { id: number; ticketNo: string; title: string; status: string };
export type QuickMeeting = { id: number; meetingNo: string; title: string; when: string };

export async function quickTickets(actor: Actor, q: string, limit = 5): Promise<QuickTicket[]> {
  if (q.length < 2) return [];
  const named = await viewerCategories(actor.id);
  const isAdmin = isAdminActor(actor) || named === "ALL";
  const viewer = { id: actor.id, isAdmin, categoryIds: named === "ALL" ? [] : named };
  const base = { categoryId: null, status: null, q, page: 1 } as const;
  const lists = await Promise.all((["mine", "assigned", "all"] as const).map((scope) => listTickets({ ...base, scope }, viewer)));
  const found = new Map<number, QuickTicket>();
  for (const list of lists) for (const item of list.items) if (!found.has(item.id)) found.set(item.id, { id: item.id, ticketNo: item.ticketNo, title: item.title, status: TICKET_STATUS_LABEL[item.status] ?? item.status });
  return [...found.values()].sort((a, b) => b.id - a.id).slice(0, limit);
}

const WHEN = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export async function quickMeetings(actor: Actor, q: string, limit = 5): Promise<QuickMeeting[]> {
  if (q.length < 2) return [];
  const scope = await scopeFor(actor);
  const { rows } = await listMeetings(scope, { tab: "all", userId: actor.id, q, typeId: null, departmentId: null, status: null, from: null, to: null, page: 1, pageSize: limit });
  return rows.map((row) => ({ id: row.id, meetingNo: row.meetingNo, title: row.title, when: WHEN.format(row.scheduledStart) }));
}

