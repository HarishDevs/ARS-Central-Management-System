import { describe, expect, it } from "vitest";
import { allowedTicketActions, canSeeTicket, isOverdue, seesInternal, statusForTask, statusText, type TicketFacts, type TicketViewer } from "@/server/tickets/rules";
import { addWorkingDays, workingDaysBetween, type WorkingCalendar } from "@/server/workflows/calendar";

// v1.55.0 (owner's ticketing brief): who may do what, and the 4 working days.
const ticket = (over: Partial<TicketFacts> = {}): TicketFacts => ({ status: "NEW", requesterId: 1, assigneeId: null, ...over });
const viewer = (id: number, over: Partial<TicketViewer> = {}): TicketViewer => ({ id, isAdmin: false, isCoordinator: false, ...over });
const requester = viewer(1);
const coordinator = viewer(2, { isCoordinator: true });
const assignee = viewer(3);
const stranger = viewer(9);

describe("ticket rules", () => {
  it("who sees a ticket: requester, the form's coordinators, the assignee, IT; nobody else", () => {
    const assigned = ticket({ status: "ASSIGNED", assigneeId: 3 });
    expect(canSeeTicket(assigned, requester)).toBe(true);
    expect(canSeeTicket(assigned, coordinator)).toBe(true);
    expect(canSeeTicket(assigned, assignee)).toBe(true);
    expect(canSeeTicket(assigned, viewer(8, { isAdmin: true }))).toBe(true);
    expect(canSeeTicket(assigned, stranger)).toBe(false);
  });

  it("coordinators assign new and reopened tickets, and reassign during the work; not while awaiting confirmation", () => {
    for (const status of ["NEW", "REOPENED", "ASSIGNED", "IN_PROGRESS"] as const) expect(allowedTicketActions(ticket({ status }), coordinator).has("ASSIGN")).toBe(true);
    expect(allowedTicketActions(ticket({ status: "AWAITING_CONFIRMATION" }), coordinator).has("ASSIGN")).toBe(false);
    expect(allowedTicketActions(ticket(), requester).has("ASSIGN")).toBe(false);
  });

  it("only the requester confirms or reopens, and only while it awaits confirmation (never the assignee)", () => {
    const awaiting = ticket({ status: "AWAITING_CONFIRMATION", assigneeId: 3 });
    expect([...allowedTicketActions(awaiting, requester)]).toEqual(expect.arrayContaining(["CONFIRM", "REOPEN"]));
    for (const other of [coordinator, assignee, viewer(8, { isAdmin: true })]) {
      expect(allowedTicketActions(awaiting, other).has("CONFIRM")).toBe(false);
      expect(allowedTicketActions(awaiting, other).has("REOPEN")).toBe(false);
    }
    // Someone who raised a ticket and was also assigned it confirms it as its requester.
    expect(allowedTicketActions(ticket({ status: "AWAITING_CONFIRMATION", requesterId: 3, assigneeId: 3 }), assignee).has("CONFIRM")).toBe(true);
    expect(allowedTicketActions(ticket({ status: "IN_PROGRESS" }), requester).has("CONFIRM")).toBe(false);
  });

  // v1.59.3 (D-362, owner): the assignee starts and resolves on the ticket (no task).
  it("only the assignee starts (Assigned, Reopened) and resolves (Assigned, In progress, Reopened)", () => {
    const at = (status: "NEW" | "ASSIGNED" | "IN_PROGRESS" | "REOPENED" | "AWAITING_CONFIRMATION") => allowedTicketActions(ticket({ status, assigneeId: 3 }), assignee);
    expect(at("ASSIGNED").has("START")).toBe(true);
    expect(at("REOPENED").has("START")).toBe(true);
    expect(at("IN_PROGRESS").has("START")).toBe(false);
    for (const status of ["ASSIGNED", "IN_PROGRESS", "REOPENED"] as const) expect(at(status).has("RESOLVE")).toBe(true);
    expect(at("AWAITING_CONFIRMATION").has("RESOLVE")).toBe(false);
    for (const other of [requester, coordinator, viewer(8, { isAdmin: true })]) {
      expect(allowedTicketActions(ticket({ status: "ASSIGNED", assigneeId: 3 }), other).has("START")).toBe(false);
      expect(allowedTicketActions(ticket({ status: "IN_PROGRESS", assigneeId: 3 }), other).has("RESOLVE")).toBe(false);
    }
  });

  it("a closed ticket allows nothing", () => {
    for (const person of [requester, coordinator, assignee]) expect(allowedTicketActions(ticket({ status: "CLOSED", assigneeId: 3 }), person).size).toBe(0);
  });

  it("internal remarks: coordinators and the assignee, never the requester", () => {
    const assigned = ticket({ status: "ASSIGNED", assigneeId: 3 });
    expect(seesInternal(assigned, coordinator)).toBe(true);
    expect(seesInternal(assigned, assignee)).toBe(true);
    expect(seesInternal(assigned, requester)).toBe(false);
  });

  it("the ticket follows its task; completing never closes it", () => {
    expect(statusForTask("IN_PROGRESS", "ASSIGNED")).toBe("IN_PROGRESS");
    expect(statusForTask("IN_PROGRESS", "REOPENED")).toBe("IN_PROGRESS");
    expect(statusForTask("COMPLETED", "IN_PROGRESS")).toBe("AWAITING_CONFIRMATION");
    expect(statusForTask("COMPLETED", "ASSIGNED")).toBe("AWAITING_CONFIRMATION");
    expect(statusForTask("COMPLETED", "CLOSED")).toBeNull();
    expect(statusForTask("BLOCKED", "IN_PROGRESS")).toBeNull();
  });

  it("status words and overdue", () => {
    expect(statusText("CLOSED", "AUTO")).toBe("Closed – auto closed");
    expect(statusText("CLOSED", "CONFIRMED")).toBe("Closed");
    const past = new Date(Date.now() - 86_400_000);
    expect(isOverdue({ status: "IN_PROGRESS", dueAt: past })).toBe(true);
    expect(isOverdue({ status: "AWAITING_CONFIRMATION", dueAt: past })).toBe(false);
    expect(isOverdue({ status: "CLOSED", dueAt: past })).toBe(false);
  });
});

describe("working days (Working Calendar)", () => {
  // Mon-Sat working (the company default), 2026-11-21 (Sat) a holiday.
  const calendar: WorkingCalendar = { workingDays: new Set(["MON", "TUE", "WED", "THU", "FRI", "SAT"]), holidays: new Set(["2026-11-21"]) };
  it("adds working days, skipping Sundays and holidays", () => {
    // Wed 18 Nov + 4 working days: Thu 19, Fri 20, (Sat 21 holiday), (Sun 22), Mon 23, Tue 24.
    expect(addWorkingDays("2026-11-18", 4, calendar)).toBe("2026-11-24");
    expect(addWorkingDays("2026-11-18", 2, calendar)).toBe("2026-11-20");
    expect(addWorkingDays("2026-11-18", 3, calendar)).toBe("2026-11-23");
    // Across a year end.
    expect(addWorkingDays("2026-12-30", 3, { workingDays: new Set(["MON", "TUE", "WED", "THU", "FRI"]), holidays: new Set(["2027-01-01"]) })).toBe("2027-01-05");
  });
  it("counts working days between two dates", () => {
    expect(workingDaysBetween("2026-11-18", "2026-11-24", calendar)).toBe(4);
    expect(workingDaysBetween("2026-11-18", "2026-11-18", calendar)).toBe(0);
  });
});
