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

// v1.90.0 (D-427, owner: "display all status count"): a Ticket dashboards
// card lists every ticket status, zeros included, in the lifecycle's order
// (tickets have one fixed lifecycle for every category, so it is the same
// list for every set-up), each with the ?status= filter of the category's
// dashboard; Closed notes how many closed on their own (?status=auto).
export interface StatusCountRow {
  status: TicketStatus;
  label: string;
  count: number;
  filter: string; // the dashboard's ?status= value
  note?: { text: string; filter: string };
}
export function statusCountRows(counts: Record<TicketStatus, number> & { AUTO: number }): StatusCountRow[] {
  return TICKET_STATUSES.map((status) => ({
    status,
    label: TICKET_STATUS_LABEL[status],
    count: counts[status],
    filter: status,
    ...(status === "CLOSED" && counts.AUTO ? { note: { text: `${counts.AUTO.toLocaleString("en-IN")} auto closed`, filter: "auto" } } : {}),
  }));
}

// What people do on the ticket page. v1.59.3 (D-362, owner: "For Ticket
// assignment i dont want task to be created instead i want an option to update
// the task status in the ticket itself"): the assignee starts and resolves the
// work on the ticket (START, RESOLVE); no task is made.
export const TICKET_ACTIONS = ["ASSIGN", "START", "RESOLVE", "CONFIRM", "REOPEN", "COMMENT"] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

export interface TicketViewer {
  id: number;
  isAdmin: boolean; // IT Admin / Super Admin: sees and coordinates every ticket
  isCoordinator: boolean; // a coordinator of the ticket's form
  // v1.57.0 (D-336): sees every ticket (Admin → Ticket categories → who else sees all tickets); read-only.
  seesAll?: boolean;
  // v1.92.0 (D-438, D-439): an active collaborator on THIS ticket (ticket_collaborators, not removed).
  isCollaborator?: boolean;
  // v1.92.0 (D-439, the Commenter rule D-434): a collaborator whose only link to
  // the ticket is that, and who doesn't have the Ticketing module: they read it,
  // download its (non-internal) files and comment; nothing else.
  commenter?: boolean;
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
  return role.requester || role.coordinator || role.assignee || Boolean(viewer.seesAll) || Boolean(viewer.isCollaborator);
}

// v1.92.0 (D-439): is the person on the ticket as a collaborator only (no other part in it)?
export function collaboratorOnly(ticket: TicketFacts, viewer: TicketViewer): boolean {
  const role = roleOf(ticket, viewer);
  return Boolean(viewer.isCollaborator) && !role.requester && !role.coordinator && !role.assignee && !viewer.seesAll;
}

// v1.92.0 (D-438, mirroring request collaborators D-127): the ticket's raiser,
// its form's coordinators (IT Admin and Super Admin coordinate every ticket)
// and its assignee add and remove collaborators. A collaborator never adds
// anyone (as on a request); one with the Ticketing module may leave (remove
// themselves); a Commenter may not (D-434).
export function mayManageTicketCollaborators(ticket: TicketFacts, viewer: TicketViewer): boolean {
  const role = roleOf(ticket, viewer);
  return role.requester || role.coordinator || role.assignee;
}
export function mayLeaveTicket(ticket: TicketFacts, viewer: TicketViewer): boolean {
  return Boolean(viewer.isCollaborator) && !viewer.commenter;
}

// v1.92.0 (D-439): may the person add files (with a remark)? Everyone who may
// comment, except a Commenter (D-434: no files without the module).
export function mayAddTicketFiles(ticket: TicketFacts, viewer: TicketViewer): boolean {
  return allowedTicketActions(ticket, viewer).has("COMMENT") && !(viewer.commenter && collaboratorOnly(ticket, viewer));
}

// Coordinator remarks are internal: coordinators and the assignee see them, the requester doesn't.
export function seesInternal(ticket: TicketFacts, viewer: TicketViewer): boolean {
  const role = roleOf(ticket, viewer);
  return role.coordinator || role.assignee || Boolean(viewer.seesAll);
}

export function allowedTicketActions(ticket: TicketFacts, viewer: TicketViewer): Set<TicketAction> {
  const role = roleOf(ticket, viewer);
  const actions = new Set<TicketAction>();
  if (ticket.status === "CLOSED") return actions;
  // Assign a new or reopened ticket, or reassign while the work is with someone.
  if (role.coordinator && ticket.status !== "AWAITING_CONFIRMATION") actions.add("ASSIGN");
  // The assignee: Start work (Assigned or Reopened → In progress), then Mark resolved (→ Awaiting confirmation).
  if (role.assignee && (ticket.status === "ASSIGNED" || ticket.status === "REOPENED")) actions.add("START");
  if (role.assignee && (ticket.status === "ASSIGNED" || ticket.status === "IN_PROGRESS" || ticket.status === "REOPENED")) actions.add("RESOLVE");
  // Only the requester confirms or reopens (never the assignee or a coordinator for them).
  if (role.requester && ticket.status === "AWAITING_CONFIRMATION") {
    actions.add("CONFIRM");
    actions.add("REOPEN");
  }
  // v1.92.0 (D-439): a collaborator comments too (with or without the module); never anything else above.
  if (role.requester || role.coordinator || role.assignee || viewer.seesAll || viewer.isCollaborator) actions.add("COMMENT");
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
