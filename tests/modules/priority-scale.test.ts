import { describe, expect, it } from "vitest";
import { INFO_PRIORITIES, INFO_PRIORITY_LABEL, PRIORITY_LABEL, TASK_PRIORITIES, TICKET_PRIORITIES, TICKET_PRIORITY_LABEL } from "@/server/modules/settings";
import { PRIORITIES as MEETING_PRIORITIES, PRIORITY_LABEL as MEETING_LABEL } from "@/server/meetings/rules";
import { hasModule, MODULE_LABEL, MODULES } from "@/server/modules/modules";

// v1.55.1 (D-329, owner: "wherever Priority is involved it should be Critical,
// Most Important, Important, High, Normal").
const SCALE = ["Critical", "Most Important", "Important", "High", "Normal"];

describe("one priority scale everywhere (D-329)", () => {
  it("tasks, tickets and meetings offer the five levels, highest first", () => {
    expect(TASK_PRIORITIES.map((p) => PRIORITY_LABEL[p])).toEqual(SCALE);
    expect(TICKET_PRIORITIES.map((p) => TICKET_PRIORITY_LABEL[p])).toEqual(SCALE);
    expect(MEETING_PRIORITIES.map((p) => MEETING_LABEL[p])).toEqual(SCALE);
  });
  it("information uses the same five (listed lowest first) and the same codes", () => {
    expect([...INFO_PRIORITIES].reverse().map((p) => INFO_PRIORITY_LABEL[p])).toEqual(SCALE);
    expect([...TICKET_PRIORITIES]).toEqual([...TASK_PRIORITIES]);
  });
});

describe("Ticketing is its own module (D-329)", () => {
  it("is listed, labelled, and needed unless Super Admin", () => {
    expect(MODULES).toContain("TICKET");
    expect(MODULE_LABEL.TICKET).toBe("Ticketing");
    expect(hasModule({ roles: ["USER"], modules: ["APPROVAL", "TASK"] }, "TICKET")).toBe(false);
    expect(hasModule({ roles: ["USER"], modules: ["TICKET"] }, "TICKET")).toBe(true);
    expect(hasModule({ roles: ["SUPER_ADMIN"], modules: [] }, "TICKET")).toBe(true);
  });
});
