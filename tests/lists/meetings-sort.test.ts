import { describe, expect, it } from "vitest";
import { isMeetingSortColumn, MEETING_SORT_COLUMNS, meetingOrderSql } from "@/server/meetings/list-sort";
import { emptyTally, sortTallies } from "@/features/meetings/MeetingStats";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in all columns").
describe("meetings list: column sorting", () => {
  it("keeps the tab's own order when no column is chosen", () => {
    expect(meetingOrderSql("upcoming", null)).toBe("m.scheduled_start ASC, m.id DESC");
    expect(meetingOrderSql("past", undefined)).toBe("m.scheduled_start DESC, m.id DESC");
  });
  it("only whitelisted columns reach ORDER BY", () => {
    expect(isMeetingSortColumn("title")).toBe(true);
    expect(isMeetingSortColumn("m.id; DROP TABLE meetings")).toBe(false);
    expect(meetingOrderSql("all", "1; DROP TABLE meetings" as never, "desc")).toBe("m.scheduled_start DESC, m.id DESC");
  });
  it("every column sorts both ways with fixed expressions", () => {
    for (const column of MEETING_SORT_COLUMNS)
      for (const dir of ["asc", "desc"] as const) {
        const order = meetingOrderSql("all", column, dir);
        expect(order).toContain(dir === "desc" ? " DESC" : " ASC");
        expect(order.endsWith("m.id DESC")).toBe(true);
        expect(order).not.toMatch(/\?/);
      }
    expect(meetingOrderSql("all", "dept", "desc")).toBe("d.name IS NULL, d.name DESC, m.scheduled_start DESC, m.id DESC");
    expect(meetingOrderSql("all", "when", "asc")).toBe("m.scheduled_start ASC, m.id DESC");
    expect(meetingOrderSql("all", "invited", "desc")).toBe("participants DESC, m.scheduled_start DESC, m.id DESC");
  });
});

describe("meeting tallies: column sorting", () => {
  const a = { ...emptyTally("Board"), held: 3, present: 5, invited: 10 };
  const b = { ...emptyTally("audit"), held: 7 };
  const c = { ...emptyTally("Plant"), held: 1, present: 9, invited: 10 };
  it("sorts names naturally, counts and rates by value, no rate last", () => {
    expect(sortTallies([a, b, c], "name", "asc").map((row) => row.name)).toEqual(["audit", "Board", "Plant"]);
    expect(sortTallies([a, b, c], "held", "desc").map((row) => row.name)).toEqual(["audit", "Board", "Plant"]);
    expect(sortTallies([a, b, c], "attendance", "desc").map((row) => row.name)).toEqual(["Plant", "Board", "audit"]);
    expect(sortTallies([a, b, c], "attendance", "asc").map((row) => row.name)).toEqual(["Board", "Plant", "audit"]);
    expect(sortTallies([a, b, c], null, "asc")).toEqual([a, b, c]);
  });
});
