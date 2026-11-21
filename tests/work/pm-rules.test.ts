import { describe, expect, it } from "vitest";
import {
  clampPaneWidth,
  daysUntilPurge,
  groupReactions,
  isReaction,
  moveInOrder,
  parseCelebration,
  parsePmExtras,
  parseSidebarSort,
  purgeableTasks,
  purgeDueAt,
  purgeText,
  reactionLabel,
  shouldCelebrate,
  sortSidebar,
  type SidebarProject,
} from "@/server/work/pm-rules";

// v1.62.0 (D-368, PM phase A part 2): the pure rules.
describe("reactions", () => {
  it("knows only the six reactions", () => {
    expect(["THUMBS_UP", "HEART", "TADA", "SMILE", "EYES", "CHECK"].every(isReaction)).toBe(true);
    expect(isReaction("ANGRY")).toBe(false);
    expect(isReaction(1)).toBe(false);
  });
  it("names a pill with the count and whether you gave it", () => {
    expect(reactionLabel("THUMBS_UP", 1, true)).toBe("thumbs up: 1 person (you). Remove your reaction");
    expect(reactionLabel("HEART", 3, true)).toBe("heart: 3 people, including you. Remove your reaction");
    expect(reactionLabel("EYES", 2, false)).toBe("looking: 2 people. Add your reaction");
    expect(reactionLabel("TADA", 0, false)).toBe("React with celebrate");
  });
  it("groups rows per comment in the fixed order and drops unknown keys", () => {
    const grouped = groupReactions([
      { commentId: 1, key: "CHECK", count: 1, mine: false },
      { commentId: 1, key: "THUMBS_UP", count: 2, mine: true },
      { commentId: 2, key: "BOGUS", count: 5, mine: false },
    ]);
    expect(grouped.get(1)?.map((item) => item.key)).toEqual(["THUMBS_UP", "CHECK"]);
    expect(grouped.has(2)).toBe(false);
  });
});

describe("task pane width", () => {
  it("is kept between 380 and 720 px, 440 by default", () => {
    expect(clampPaneWidth(500)).toBe(500);
    expect(clampPaneWidth(100)).toBe(380);
    expect(clampPaneWidth(5000)).toBe(720);
    expect(clampPaneWidth("610")).toBe(610);
    expect(clampPaneWidth("wide")).toBe(440);
    expect(clampPaneWidth(null)).toBe(440);
  });
});

describe("celebrations", () => {
  it("parses only Off / Occasional / Always", () => {
    expect(parseCelebration("ALWAYS")).toBe("ALWAYS");
    expect(parseCelebration("sometimes")).toBeNull();
  });
  it("never shows with reduced motion or Off; Always always; Occasional about one in four", () => {
    expect(shouldCelebrate("ALWAYS", true, 0)).toBe(false);
    expect(shouldCelebrate("OFF", false, 0)).toBe(false);
    expect(shouldCelebrate("ALWAYS", false, 0.99)).toBe(true);
    expect(shouldCelebrate("OCCASIONAL", false, 0.1)).toBe(true);
    expect(shouldCelebrate("OCCASIONAL", false, 0.3)).toBe(false);
  });
  it("Admin's defaults: Occasional and purge on; bad values fall back", () => {
    expect(parsePmExtras(null)).toEqual({ celebrations: "OCCASIONAL", purge: true });
    expect(parsePmExtras('{"celebrations":"OFF","purge":false}')).toEqual({ celebrations: "OFF", purge: false });
    expect(parsePmExtras("not json")).toEqual({ celebrations: "OCCASIONAL", purge: true });
    expect(parsePmExtras('{"celebrations":"LOUD"}')).toEqual({ celebrations: "OCCASIONAL", purge: true });
  });
});

describe("sidebar lists", () => {
  const p = (id: number, name: string, extra: Partial<SidebarProject> = {}): SidebarProject => ({ id, name, color: "blue", position: null, openedAt: null, starredAt: null, ...extra });
  const items = [
    p(1, "Zeta", { starredAt: "2026-11-01T00:00:00.000Z", openedAt: "2026-11-20T00:00:00.000Z" }),
    p(2, "alpha", { starredAt: "2026-11-02T00:00:00.000Z" }),
    p(3, "Mid", { starredAt: "2026-11-03T00:00:00.000Z", position: 1024, openedAt: "2026-11-21T00:00:00.000Z" }),
  ];
  it("Manual: own places first, then by when starred", () => {
    expect(sortSidebar(items, "MANUAL").map((item) => item.id)).toEqual([3, 1, 2]);
  });
  it("A–Z ignores case; Recent puts the last opened first", () => {
    expect(sortSidebar(items, "AZ").map((item) => item.name)).toEqual(["alpha", "Mid", "Zeta"]);
    expect(sortSidebar(items, "RECENT").map((item) => item.id)).toEqual([3, 1, 2]);
  });
  it("defaults: Starred Manual, Departments A–Z", () => {
    expect(parseSidebarSort(null, "STARRED")).toBe("MANUAL");
    expect(parseSidebarSort(null, "DEPARTMENTS")).toBe("AZ");
    expect(parseSidebarSort("RECENT", "DEPARTMENTS")).toBe("RECENT");
  });
  it("moves one place up or down, not past the ends", () => {
    expect(moveInOrder([1, 2, 3], 2, "up")).toEqual([2, 1, 3]);
    expect(moveInOrder([1, 2, 3], 2, "down")).toEqual([1, 3, 2]);
    expect(moveInOrder([1, 2, 3], 1, "up")).toBeNull();
    expect(moveInOrder([1, 2, 3], 3, "down")).toBeNull();
    expect(moveInOrder([1, 2, 3], 9, "up")).toBeNull();
  });
});

describe("purge after 30 days", () => {
  const deleted = new Date("2026-11-01T10:00:00.000Z");
  it("is due 30 days after deletion", () => {
    expect(purgeDueAt(deleted).toISOString()).toBe("2026-12-01T10:00:00.000Z");
    expect(daysUntilPurge(deleted, new Date("2026-11-21T10:00:00.000Z"))).toBe(10);
    expect(daysUntilPurge(deleted, new Date("2026-12-05T00:00:00.000Z"))).toBe(0);
  });
  it("says when an item goes, or that it stays when the purge is off", () => {
    expect(purgeText(deleted, new Date("2026-11-21T10:00:00.000Z"), true)).toBe("Removed for good on 1 Dec 2026 (in 10 days)");
    expect(purgeText(deleted, new Date("2026-11-30T12:00:00.000Z"), true)).toBe("Removed for good on 1 Dec 2026 (in 1 day)");
    expect(purgeText(deleted, new Date("2026-12-05T00:00:00.000Z"), true)).toBe("Removed for good at the next clean-up");
    expect(purgeText(deleted, new Date(), false)).toBe("Kept until restored (automatic removal is off)");
  });
  it("keeps a parent whose subtask stays; returns subtasks before parents", () => {
    // 1 ─ 2 ─ 3 (all candidates); 4 ─ 5 (5 is not a candidate: restored or a work step)
    const candidates = [
      { id: 1, parentId: null, depth: 0 },
      { id: 2, parentId: 1, depth: 1 },
      { id: 3, parentId: 2, depth: 2 },
      { id: 4, parentId: null, depth: 0 },
    ];
    const children = new Map([
      [1, [2]],
      [2, [3]],
      [4, [5]],
    ]);
    expect(purgeableTasks(candidates, children)).toEqual([3, 2, 1]);
  });
  it("a deleted subtask of a living parent goes on its own", () => {
    expect(purgeableTasks([{ id: 7, parentId: 6, depth: 1 }], new Map())).toEqual([7]);
  });
});
