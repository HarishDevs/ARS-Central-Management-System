// v1.55.0 (D-326, D-327; owner's simple brief, 18 Nov 2026): the Ticketing
// System's rules. Pure, so who may do what is unit-tested and enforced on the
// server (every action re-reads the ticket under a lock and asks again).
//
// RAISE → coordinator ASSIGNS (a linked task is made) → assignee works in the
// task → completing the task asks the requester → CONFIRM closes, REOPEN goes
// back to the coordinators, no answer in 4 working days closes it (AUTO).

export const TICKET_STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION", "REOPENED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  REOPENED: "Reopened",
  CLOSED: "Closed",
};
// "Closed – auto closed" is CLOSED with close_kind AUTO.
export function statusText(status: TicketStatus, closeKind: string | null): string {
  return status === "CLOSED" && closeKind === "AUTO" ? "Closed – auto closed" : TICKET_STATUS_LABEL[status];
}
export const OPEN_STATUSES: readonly TicketStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION", "REOPENED"];

// What people do on the ticket page (the assignee's Start / Complete happen in the task).
export const TICKET_ACTIONS = ["ASSIGN", "CONFIRM", "REOPEN", "COMMENT"] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

export interface TicketViewer {
  id: number;
  isAdmin: boolean; // IT Admin / Super Admin: sees and coordinates every ticket
  isCoordinator: boolean; // a coordinator of the ticket's form
}
export interface TicketFacts {
  status: TicketStatus;
  requesterId: number;
  assigneeId: number | null;
}

export const roleOf = (ticket: TicketFacts, viewer: TicketViewer) => ({
  requester: ticket.requesterId === viewer.id,
  coordinator: viewer.isCoordinator || viewer.isAdmin,
  assignee: ticket.assigneeId !== null && ticket.assigneeId === viewer.id,
});

export function canSeeTicket(ticket: TicketFacts, viewer: TicketViewer): boolean {
  const role = roleOf(ticket, viewer);
  return role.requester || role.coordinator || role.assignee;
}

// Coordinator remarks are internal: coordinators and the assignee see them, the requester doesn't.
export function seesInternal(ticket: TicketFacts, viewer: TicketViewer): boolean {
  const role = roleOf(ticket, viewer);
  return role.coordinator || role.assignee;
}

export function allowedTicketActions(ticket: TicketFacts, viewer: TicketViewer): Set<TicketAction> {
  const role = roleOf(ticket, viewer);
  const actions = new Set<TicketAction>();
  if (ticket.status === "CLOSED") return actions;
  // Assign a new or reopened ticket, or reassign while the work is with someone.
  if (role.coordinator && ticket.status !== "AWAITING_CONFIRMATION") actions.add("ASSIGN");
  // Only the requester confirms or reopens (never the assignee or a coordinator for them).
  if (role.requester && ticket.status === "AWAITING_CONFIRMATION") {
    actions.add("CONFIRM");
    actions.add("REOPEN");
  }
  if (role.requester || role.coordinator || role.assignee) actions.add("COMMENT");
  return actions;
}

// The ticket follows its task: started → IN_PROGRESS, completed → AWAITING_CONFIRMATION.
export function statusForTask(taskStatus: string, current: TicketStatus): TicketStatus | null {
  if (current === "CLOSED" || current === "AWAITING_CONFIRMATION") return null;
  if (taskStatus === "IN_PROGRESS" && (current === "ASSIGNED" || current === "REOPENED")) return "IN_PROGRESS";
  if (taskStatus === "COMPLETED") return "AWAITING_CONFIRMATION";
  return null;
}

// Overdue: open and past the coordinator's target date.
export function isOverdue(ticket: { status: TicketStatus; dueAt: Date | null }, now = new Date()): boolean {
  return ticket.status !== "CLOSED" && ticket.status !== "AWAITING_CONFIRMATION" && ticket.dueAt !== null && ticket.dueAt.getTime() < now.getTime();
}

// Ticket numbers: PREFIX-YEAR-00001 (at most 10 characters: request_sequences.prefix).
export const PREFIX_PATTERN = /^[A-Z][A-Z0-9-]{0,8}[A-Z0-9]$/;

// Confirmation stages, in working days after the request: reminders on 2 and 3, close after 4.
export const CONFIRM_STAGES = [
  { stage: "REMIND_2", days: 2 },
  { stage: "REMIND_3", days: 3 },
  { stage: "CLOSE", days: 4 },
] as const;
export type ConfirmStage = (typeof CONFIRM_STAGES)[number]["stage"];
