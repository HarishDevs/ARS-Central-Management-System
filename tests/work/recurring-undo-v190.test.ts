import { describe, expect, it } from "vitest";
import { nextOccurrence, ruleToGiveBack, undoNextDecision } from "@/server/work/more-rules";

// v1.90.0 (D-428, owner: "after completing a task, if we click on Undo and then
// complete the same task again, the task for the next day is not being created").
describe("Undo of a completed repeating task", () => {
  const facts = { nextOpen: true, nextCarriesRule: true, sameSeries: true, touches: 0 };
  it("removes the untouched next task (so completing again makes it again)", () => {
    expect(undoNextDecision(facts)).toBe("REMOVE");
  });
  it("keeps a next task someone touched, closed, or that no longer carries the rule", () => {
    expect(undoNextDecision({ ...facts, touches: 1 })).toBe("KEEP");
    expect(undoNextDecision({ ...facts, nextOpen: false })).toBe("KEEP");
    expect(undoNextDecision({ ...facts, nextCarriesRule: false })).toBe("KEEP");
    expect(undoNextDecision({ ...facts, sameSeries: false })).toBe("KEEP");
  });
  it("gives back the rule as it was, so completing again plans the same next day (not the day after)", () => {
    const rule = { kind: "DAILY" as const, every: 1, weekdays: [] };
    const first = nextOccurrence(rule, "2026-11-25", "2026-11-25");
    expect(first.planned).toBe("2026-11-26");
    const back = ruleToGiveBack(rule, first.rule)!;
    expect(nextOccurrence(back, "2026-11-25", "2026-11-25").planned).toBe("2026-11-26");
    // Before the fix the next task's rule (planned 26th) would have planned the 27th.
    expect(nextOccurrence(first.rule, "2026-11-25", "2026-11-25").planned).toBe("2026-11-27");
  });
  it("older history (no saved rule): the next task's rule, planned again from the reopened task's due day", () => {
    const after = { kind: "MONTHLY" as const, every: 1, weekdays: [], planned: "2026-12-25", anchorDay: 25 };
    const back = ruleToGiveBack(undefined, JSON.stringify(after))!;
    expect(back.planned).toBeUndefined();
    expect(nextOccurrence(back, "2026-11-25", "2026-11-25").planned).toBe("2026-12-25");
    expect(ruleToGiveBack(null, null)).toBeNull();
  });
});
