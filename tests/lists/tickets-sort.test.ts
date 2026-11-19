import { describe, expect, it } from "vitest";
import { TICKET_SORT_COLUMNS, ticketOrderBy, type TicketBoardItem } from "@/lib/db/repositories/tickets.repository";
import { BOARD_SORT_COLUMNS, boardSortValue } from "@/features/tickets/TicketParts";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in all columns").
describe("ticket table SQL sort (My tickets, category dashboards)", () => {
  it("keeps the old order (newest first) when nothing is chosen", () => {
    expect(ticketOrderBy(null)).toBe("ORDER BY k.id DESC");
    expect(ticketOrderBy({ sortBy: null, dir: "desc" })).toBe("ORDER BY k.id DESC");
  });
  it("sorts every column both ways, newest first on ties", () => {
    for (const column of TICKET_SORT_COLUMNS) {
      const asc = ticketOrderBy({ sortBy: column, dir: "asc" });
      const desc = ticketOrderBy({ sortBy: column, dir: "desc" });
      expect(asc).toMatch(/ ASC, k\.id DESC$/);
      expect(desc).toMatch(/ DESC, k\.id DESC$/);
      expect(asc).not.toBe("ORDER BY k.id DESC");
    }
  });
  it("puts empty values last in both directions", () => {
    expect(ticketOrderBy({ sortBy: "target", dir: "asc" })).toBe("ORDER BY k.due_at IS NULL, k.due_at ASC, k.id DESC");
    expect(ticketOrderBy({ sortBy: "assignee", dir: "desc" })).toBe("ORDER BY a.name IS NULL, a.name DESC, k.id DESC");
    expect(ticketOrderBy({ sortBy: "subject", dir: "asc" })).toBe("ORDER BY k.title ASC, k.id DESC");
  });
  it("sorts priority and status in the order a ticket is handled", () => {
    expect(ticketOrderBy({ sortBy: "priority", dir: "asc" })).toContain("FIELD(k.priority, 'URGENT', 'HIGH', 'IMPORTANT', 'ELEVATED', 'NORMAL') ASC");
    expect(ticketOrderBy({ sortBy: "status", dir: "desc" })).toContain("FIELD(k.status, 'NEW', 'REOPENED', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'CLOSED') DESC");
  });
  it("never puts address text into SQL", () => {
    const sort = parseColumnSort({ sortBy: "k.id; DROP TABLE tickets", dir: "desc" }, TICKET_SORT_COLUMNS);
    expect(ticketOrderBy(sort)).toBe("ORDER BY k.id DESC");
    expect(ticketOrderBy({ sortBy: "__proto__" as never, dir: "asc" })).toBe("ORDER BY k.id DESC");
  });
});

const item = (over: Partial<TicketBoardItem>): TicketBoardItem => ({
  id: 1,
  ticketNo: "IT-0001",
  title: "A",
  categoryName: "IT",
  typeName: "Laptop",
  requesterName: "Asha",
  departmentName: null,
  assigneeName: null,
  priority: "NORMAL",
  status: "NEW",
  closeKind: null,
  submittedAt: new Date("2026-11-01T00:00:00Z"),
  dueAt: null,
  requiredOn: null,
  confirmDueOn: null,
  reopenCount: 0,
  statusSince: new Date("2026-11-10T00:00:00Z"),
  taskNo: null,
  ...over,
});

describe("Coordinator board sort (rows on the page, inside each status)", () => {
  it("has a value for every sortable column", () => {
    for (const column of BOARD_SORT_COLUMNS) expect(() => boardSortValue(item({}), column)).not.toThrow();
  });
  it("sorts priority Urgent first when ascending", () => {
    const rows = [item({ id: 1, priority: "NORMAL" }), item({ id: 2, priority: "URGENT" }), item({ id: 3, priority: "HIGH" })];
    expect(sortRows(rows, (row) => boardSortValue(row, "priority"), "asc").map((row) => row.id)).toEqual([2, 3, 1]);
    expect(sortRows(rows, (row) => boardSortValue(row, "priority"), "desc").map((row) => row.id)).toEqual([1, 3, 2]);
  });
  it("sorts 'In this status' shortest first when ascending", () => {
    const rows = [item({ id: 1, statusSince: new Date("2026-11-01T00:00:00Z") }), item({ id: 2, statusSince: new Date("2026-11-18T00:00:00Z") })];
    expect(sortRows(rows, (row) => boardSortValue(row, "since"), "asc").map((row) => row.id)).toEqual([2, 1]);
    expect(sortRows(rows, (row) => boardSortValue(row, "since"), "desc").map((row) => row.id)).toEqual([1, 2]);
  });
  it("keeps tickets with no target date or no assignee last both ways", () => {
    const rows = [item({ id: 1 }), item({ id: 2, dueAt: new Date("2026-11-20T00:00:00Z"), assigneeName: "Zed" }), item({ id: 3, dueAt: new Date("2026-11-19T00:00:00Z"), assigneeName: "Bala" })];
    expect(sortRows(rows, (row) => boardSortValue(row, "target"), "asc").map((row) => row.id)).toEqual([3, 2, 1]);
    expect(sortRows(rows, (row) => boardSortValue(row, "target"), "desc").map((row) => row.id)).toEqual([2, 3, 1]);
    expect(sortRows(rows, (row) => boardSortValue(row, "assignee"), "desc").map((row) => row.id)).toEqual([2, 3, 1]);
  });
  it("sorts ticket numbers naturally and needed-by days by date", () => {
    const rows = [item({ id: 1, ticketNo: "IT-10", requiredOn: "2026-12-01" }), item({ id: 2, ticketNo: "IT-9", requiredOn: "2026-11-25" })];
    expect(sortRows(rows, (row) => boardSortValue(row, "ticket"), "asc").map((row) => row.id)).toEqual([2, 1]);
    expect(sortRows(rows, (row) => boardSortValue(row, "needed"), "asc").map((row) => row.id)).toEqual([2, 1]);
  });
});
