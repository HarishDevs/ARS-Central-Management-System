import { describe, expect, it } from "vitest";
import { statusCountRows, TICKET_STATUSES } from "@/server/tickets/rules";

// v1.90.0 (D-427, owner: "display all status count").
describe("Ticket dashboards: every status count", () => {
  const zero = { NEW: 0, ASSIGNED: 0, IN_PROGRESS: 0, AWAITING_CONFIRMATION: 0, REOPENED: 0, CLOSED: 0, AUTO: 0 };
  it("lists every status in the lifecycle's order, zeros included, each with its dashboard filter", () => {
    const rows = statusCountRows(zero);
    expect(rows.map((row) => row.status)).toEqual([...TICKET_STATUSES]);
    expect(rows.map((row) => row.label)).toEqual(["New", "Assigned", "In progress", "Awaiting confirmation", "Reopened", "Closed"]);
    expect(rows.every((row) => row.count === 0 && row.filter === row.status && !row.note)).toBe(true);
  });
  it("gives each status its own count; Closed notes the auto-closed ones with their filter", () => {
    const rows = statusCountRows({ ...zero, NEW: 4, REOPENED: 1, CLOSED: 12, AUTO: 3 });
    expect(Object.fromEntries(rows.map((row) => [row.status, row.count]))).toMatchObject({ NEW: 4, REOPENED: 1, CLOSED: 12, ASSIGNED: 0 });
    expect(rows.find((row) => row.status === "CLOSED")!.note).toEqual({ text: "3 auto closed", filter: "auto" });
  });
});
