import { describe, expect, it } from "vitest";
import { applyGrid, DEFAULT_GRID, GROUP_LABEL, GROUPS, type GridTask } from "@/server/work/grid";
import { groupsFor } from "@/server/requests/list-filters";

// v1.57.3 (D-341, owner: "in all the Group option add department wise Group by").
const task = (id: number, department: string | null): GridTask => ({
  id,
  taskNo: `TSK-${id}`,
  title: `Task ${id}`,
  status: "OPEN",
  priority: "NORMAL",
  assigneeId: id,
  assigneeName: `Person ${id}`,
  assigneeDepartment: department,
  createdBy: 1,
  createdByName: "Boss",
  dueAt: null,
  startsOn: null,
  createdAt: "2026-11-19T00:00:00.000Z",
  completedAt: null,
  likes: 0,
  comments: 0,
  subtasks: 0,
  isPeriodic: false,
  isMilestone: false,
  projects: [],
  tags: [],
  followers: [],
  sectionId: null,
  position: 0,
  canEdit: true,
  canComplete: true,
});

describe("Group by Department", () => {
  it("is a task-table group, by the assignee's department; no department comes last", () => {
    expect(GROUPS).toContain("department");
    expect(GROUP_LABEL.department).toBe("Department");
    const groups = applyGrid([task(1, "Purchase"), task(2, null), task(3, "IT department"), task(4, "Purchase")], { ...DEFAULT_GRID, group: "department" }, { today: "2026-11-19", meId: 1 });
    expect(groups.map((group) => [group.name, group.rows.length])).toEqual([
      ["IT department", 1],
      ["Purchase", 2],
      ["No department", 1],
    ]);
  });
  it("is on every request list (Raised by only where others' requests show)", () => {
    for (const base of ["MINE", "COLLAB", "APPROVED_MINE", "APPROVED_BY_ME"] as const) expect(groupsFor(base)).toContain("dept");
    expect(groupsFor("MINE")).not.toContain("raiser");
  });
});
