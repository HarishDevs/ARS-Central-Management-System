import { describe, expect, it } from "vitest";
import { allowedTicketActions, canSeeTicket, collaboratorOnly, mayAddTicketFiles, mayLeaveTicket, mayManageTicketCollaborators, seesInternal, type TicketFacts, type TicketViewer } from "@/server/tickets/rules";
import { allowedCollabTabs, collabTabHref, pickCollabTab, type CollabAccessFacts } from "@/server/collaborating/tabs";
import { parseReturnTo } from "@/lib/nav/return-to";

// v1.92.0 (D-438..D-441, owner 26 Nov 2026 answering Q-036: "tickets get
// collaborators, like requests"): who may do what on a ticket as a collaborator,
// and the Collaborating screen's Tickets tab. Pure rules; the server re-checks
// them under a lock (tests/integration/v192-ticket-collaborators.int.test.ts).
const ticket: TicketFacts = { status: "IN_PROGRESS", requesterId: 1, assigneeId: 2 };
const nobody: TicketViewer = { id: 9, isAdmin: false, isCoordinator: false };
const collaborator: TicketViewer = { ...nobody, isCollaborator: true };
const commenter: TicketViewer = { ...nobody, isCollaborator: true, commenter: true };

describe("ticket collaborator rights (D-439)", () => {
  it("a stranger sees nothing; an active collaborator sees the ticket", () => {
    expect(canSeeTicket(ticket, nobody)).toBe(false);
    expect(canSeeTicket(ticket, collaborator)).toBe(true);
    expect(canSeeTicket(ticket, commenter)).toBe(true);
  });
  it("a collaborator only comments: never assigns, starts, resolves, confirms or reopens", () => {
    for (const status of ["NEW", "ASSIGNED", "IN_PROGRESS", "AWAITING_CONFIRMATION", "REOPENED"] as const) {
      expect([...allowedTicketActions({ ...ticket, status }, collaborator)]).toEqual(["COMMENT"]);
      expect([...allowedTicketActions({ ...ticket, status }, commenter)]).toEqual(["COMMENT"]);
    }
    expect(allowedTicketActions({ ...ticket, status: "CLOSED" }, collaborator).size).toBe(0);
  });
  it("internal remarks stay with coordinators and the assignee", () => {
    expect(seesInternal(ticket, collaborator)).toBe(false);
    expect(seesInternal(ticket, commenter)).toBe(false);
  });
  it("files: a collaborator with the module adds them; a Commenter doesn't (D-434)", () => {
    expect(mayAddTicketFiles(ticket, collaborator)).toBe(true);
    expect(mayAddTicketFiles(ticket, commenter)).toBe(false);
    expect(mayAddTicketFiles(ticket, { ...nobody, id: 1 })).toBe(true);
  });
  it("another part in the ticket wins over being a collaborator", () => {
    expect(collaboratorOnly(ticket, collaborator)).toBe(true);
    expect(collaboratorOnly(ticket, { ...collaborator, id: 2 })).toBe(false);
    expect(collaboratorOnly(ticket, { ...collaborator, isCoordinator: true })).toBe(false);
    expect(collaboratorOnly(ticket, { ...collaborator, seesAll: true })).toBe(false);
    expect(allowedTicketActions({ ...ticket, status: "ASSIGNED" }, { ...collaborator, id: 2 }).has("START")).toBe(true);
  });
});

describe("who manages a ticket's collaborators (D-438, mirroring requests)", () => {
  it("the raiser, the coordinators (IT included) and the assignee", () => {
    expect(mayManageTicketCollaborators(ticket, { ...nobody, id: 1 })).toBe(true);
    expect(mayManageTicketCollaborators(ticket, { ...nobody, id: 2 })).toBe(true);
    expect(mayManageTicketCollaborators(ticket, { ...nobody, isCoordinator: true })).toBe(true);
    expect(mayManageTicketCollaborators(ticket, { ...nobody, isAdmin: true })).toBe(true);
  });
  it("never a collaborator, a read-only viewer or a stranger", () => {
    expect(mayManageTicketCollaborators(ticket, collaborator)).toBe(false);
    expect(mayManageTicketCollaborators(ticket, commenter)).toBe(false);
    expect(mayManageTicketCollaborators(ticket, { ...nobody, seesAll: true })).toBe(false);
    expect(mayManageTicketCollaborators(ticket, nobody)).toBe(false);
  });
  it("a collaborator with the module may leave; a Commenter may not", () => {
    expect(mayLeaveTicket(ticket, collaborator)).toBe(true);
    expect(mayLeaveTicket(ticket, commenter)).toBe(false);
    expect(mayLeaveTicket(ticket, nobody)).toBe(false);
  });
});

describe("the Collaborating screen's Tickets tab (D-441)", () => {
  const facts: CollabAccessFacts = { approvalModule: true, requestPageOpen: true, approvalItems: 0, taskModule: true, tasksSwitch: true, taskPageOpen: true, taskItems: 0, ticketModule: true, ticketPageOpen: true, ticketItems: 0 };
  it("with the Ticketing module, or at least one active collaboration", () => {
    expect(allowedCollabTabs(facts)).toEqual(["approvals", "tasks", "tickets"]);
    expect(allowedCollabTabs({ ...facts, ticketModule: false })).toEqual(["approvals", "tasks"]);
    expect(allowedCollabTabs({ ...facts, ticketModule: false, ticketItems: 1 })).toEqual(["approvals", "tasks", "tickets"]);
    expect(allowedCollabTabs({ ...facts, approvalModule: false, taskModule: false, ticketModule: false, ticketItems: 2 })).toEqual(["tickets"]);
  });
  it("the ticket page Hidden by page access hides the tab", () => {
    expect(allowedCollabTabs({ ...facts, ticketPageOpen: false, ticketItems: 3 })).toEqual(["approvals", "tasks"]);
  });
  it("?tab=tickets opens it when allowed and falls back when not", () => {
    expect(pickCollabTab({ tab: "tickets" }, ["approvals", "tasks", "tickets"], {})).toBe("tickets");
    expect(pickCollabTab({ tab: "tickets" }, ["approvals", "tasks"], {})).toBe("approvals");
    expect(pickCollabTab({}, ["approvals", "tasks", "tickets"], { tickets: 1 })).toBe("tickets");
    expect(collabTabHref("tickets", { q: "IT-SW" })).toBe("/users/collaborating?tab=tickets&q=IT-SW");
  });
  it("a ticket opened from the tab may go back to it (?from=), nowhere else under /users", () => {
    const users = (area: string) => area === "users";
    expect(parseReturnTo("/users/collaborating?tab=tickets&q=x", users)).toEqual({ href: "/users/collaborating?tab=tickets&q=x", label: "Collaborating", area: "users" });
    expect(parseReturnTo("/users/collaborating/../admin", users)).toBeNull();
    expect(parseReturnTo("/users/inbox", users)).toBeNull();
  });
});
