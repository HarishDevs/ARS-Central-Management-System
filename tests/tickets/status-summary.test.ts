import { describe, expect, it } from "vitest";
import { classifyTicket, endOfIndiaDay, parsePriorityFilter, summariseStatusByDepartment, ticketDue, type StatusSummaryTicket } from "@/server/tickets/status-summary";

// v1.59.2 (D-360, owner: "Priority wise IT Software Issues Status"): the
// On time / Delay / Overdue / Not due rules and the per-form department tables.
const at = (iso: string) => new Date(iso);
const facts = (over: Partial<{ dueAt: Date | null; requiredOn: string | null; closedAt: Date | null }> = {}) => ({ dueAt: null, requiredOn: null, closedAt: null, ...over });
const ticket = (over: Partial<StatusSummaryTicket> = {}): StatusSummaryTicket => ({
  categoryId: 1,
  categoryName: "IT Software",
  categoryPosition: 1,
  departmentId: 10,
  departmentName: "Accounts",
  priority: "NORMAL",
  dueAt: null,
  requiredOn: null,
  closedAt: null,
  ...over,
});
const NOW = at("2026-11-20T06:30:00Z"); // 12:00 India time

describe("a reopened ticket (v1.59.2)", () => {
  it("keeps its old closed time but counts as open again", () => {
    const facts = { dueAt: new Date("2026-11-01T06:00:00Z"), requiredOn: null, closedAt: new Date("2026-10-30T06:00:00Z") };
    expect(classifyTicket({ ...facts, status: "CLOSED" }, new Date("2026-11-10T06:00:00Z"))).toBe("ON_TIME");
    expect(classifyTicket({ ...facts, status: "REOPENED" }, new Date("2026-11-10T06:00:00Z"))).toBe("OVERDUE");
  });
});

describe("ticket due date", () => {
  it("the Required date is due by the end of that India day (UTC+5:30)", () => {
    expect(endOfIndiaDay("2026-11-20")!.toISOString()).toBe("2026-11-20T18:29:59.999Z");
    expect(ticketDue(facts({ requiredOn: "2026-11-20" }))!.toISOString()).toBe("2026-11-20T18:29:59.999Z");
    expect(endOfIndiaDay("not a day")).toBeNull();
  });

  it("the coordinator's Target date wins over the Required date", () => {
    const target = at("2026-11-25T05:00:00Z");
    expect(ticketDue(facts({ dueAt: target, requiredOn: "2026-11-20" }))).toBe(target);
  });

  it("neither date: no due date", () => {
    expect(ticketDue(facts())).toBeNull();
  });
});

describe("classifyTicket", () => {
  it("closed exactly at the due time is On time; one second later is Delay", () => {
    const due = at("2026-11-18T10:00:00Z");
    expect(classifyTicket(facts({ dueAt: due, closedAt: at("2026-11-18T10:00:00Z") }), NOW)).toBe("ON_TIME");
    expect(classifyTicket(facts({ dueAt: due, closedAt: at("2026-11-18T10:00:01Z") }), NOW)).toBe("DELAY");
  });

  it("closed late on the Required day (India time) is still On time; after midnight India time it is Delay", () => {
    expect(classifyTicket(facts({ requiredOn: "2026-11-18", closedAt: at("2026-11-18T18:29:59Z") }), NOW)).toBe("ON_TIME");
    expect(classifyTicket(facts({ requiredOn: "2026-11-18", closedAt: at("2026-11-18T18:30:00Z") }), NOW)).toBe("DELAY");
  });

  it("the Target date overrides the Required date", () => {
    // Required by 18 Nov, but the coordinator set 22 Nov: closing on 21 Nov is On time.
    expect(classifyTicket(facts({ requiredOn: "2026-11-18", dueAt: at("2026-11-22T12:00:00Z"), closedAt: at("2026-11-21T12:00:00Z") }), NOW)).toBe("ON_TIME");
    // Required by 25 Nov, but the coordinator set 19 Nov: still open on 20 Nov is Overdue.
    expect(classifyTicket(facts({ requiredOn: "2026-11-25", dueAt: at("2026-11-19T12:00:00Z") }), NOW)).toBe("OVERDUE");
  });

  it("closed with no due date is On time", () => {
    expect(classifyTicket(facts({ closedAt: at("2026-11-19T12:00:00Z") }), NOW)).toBe("ON_TIME");
  });

  it("open: Overdue once the due has passed, Not due before it or with no due date", () => {
    expect(classifyTicket(facts({ requiredOn: "2026-11-19" }), NOW)).toBe("OVERDUE");
    expect(classifyTicket(facts({ requiredOn: "2026-11-20" }), NOW)).toBe("NOT_DUE"); // due tonight, India time
    expect(classifyTicket(facts({ dueAt: NOW }), NOW)).toBe("NOT_DUE"); // exactly at the due: not yet passed
    expect(classifyTicket(facts({ dueAt: at("2026-11-20T06:29:59Z") }), NOW)).toBe("OVERDUE");
    expect(classifyTicket(facts(), NOW)).toBe("NOT_DUE");
  });
});

describe("parsePriorityFilter", () => {
  it("accepts the five ticket priorities; anything else is All", () => {
    for (const value of ["URGENT", "HIGH", "IMPORTANT", "ELEVATED", "NORMAL"]) expect(parsePriorityFilter(value)).toBe(value);
    expect(parsePriorityFilter(undefined)).toBe("ALL");
    expect(parsePriorityFilter("")).toBe("ALL");
    expect(parsePriorityFilter("MEDIUM")).toBe("ALL");
    expect(parsePriorityFilter("normal")).toBe("ALL");
  });
});

describe("summariseStatusByDepartment", () => {
  const tickets: StatusSummaryTicket[] = [
    ticket({ departmentId: 10, departmentName: "Accounts", closedAt: at("2026-11-19T10:00:00Z") }), // On time
    ticket({ departmentId: 10, departmentName: "Accounts", requiredOn: "2026-11-10", closedAt: at("2026-11-15T10:00:00Z"), priority: "URGENT" }), // Delay
    ticket({ departmentId: null, departmentName: null, requiredOn: "2026-11-10" }), // Overdue, Others
    ticket({ departmentId: 20, departmentName: "ASP", priority: "URGENT" }), // Not due
    ticket({ departmentId: 30, departmentName: "branding", requiredOn: "2026-11-19", priority: "URGENT" }), // Overdue
    ticket({ categoryId: 2, categoryName: "IT Hardware", categoryPosition: 2, departmentId: 20, departmentName: "ASP", dueAt: at("2026-12-01T00:00:00Z") }), // Not due
  ];

  it("one table per form, in the forms' order; departments by name, Others last", () => {
    const tables = summariseStatusByDepartment(tickets, "ALL", NOW);
    expect(tables.map((table) => table.categoryName)).toEqual(["IT Software", "IT Hardware"]);
    expect(tables[0]!.rows.map((row) => row.department)).toEqual(["Accounts", "ASP", "branding", "Others"]);
    expect(tables[1]!.rows.map((row) => row.department)).toEqual(["ASP"]);
  });

  it("counts each ticket once; the columns add up to Total and the rows add up to the Total row", () => {
    const [software] = summariseStatusByDepartment(tickets, "ALL", NOW);
    expect(software!.rows.find((row) => row.department === "Accounts")).toMatchObject({ total: 2, onTime: 1, delay: 1, overdue: 0, notDue: 0 });
    expect(software!.rows.find((row) => row.department === "Others")).toMatchObject({ total: 1, overdue: 1 });
    expect(software!.total).toEqual({ total: 5, onTime: 1, delay: 1, overdue: 2, notDue: 1 });
    for (const row of [...software!.rows, software!.total]) expect(row.onTime + row.delay + row.overdue + row.notDue).toBe(row.total);
  });

  it("a priority counts only that priority's tickets; the form's departments stay, with zeros", () => {
    const tables = summariseStatusByDepartment(tickets, "URGENT", NOW);
    expect(tables.map((table) => table.categoryName)).toEqual(["IT Software", "IT Hardware"]);
    const [software, hardware] = tables;
    expect(software!.total).toEqual({ total: 3, onTime: 0, delay: 1, overdue: 1, notDue: 1 });
    expect(software!.rows.map((row) => [row.department, row.total])).toEqual([
      ["Accounts", 1],
      ["ASP", 1],
      ["branding", 1],
      ["Others", 0],
    ]);
    expect(hardware!.total.total).toBe(0);
    expect(summariseStatusByDepartment(tickets, "NORMAL", NOW)[0]!.total.total).toBe(2);
  });

  it("no tickets: no tables", () => {
    expect(summariseStatusByDepartment([], "ALL", NOW)).toEqual([]);
  });
});
