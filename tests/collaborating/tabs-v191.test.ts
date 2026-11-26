import { describe, expect, it } from "vitest";
import { allowedCollabTabs, collabTabHref, pickCollabTab, type CollabAccessFacts } from "@/server/collaborating/tabs";
import { commenterRights, taskRights } from "@/server/work/access";
import { allowedTaskActions, type TaskViewer } from "@/server/modules/task-rules";

// v1.91.0 (D-433, D-434): the Collaborating screen's tabs and the Commenter rule.
const full: CollabAccessFacts = { approvalModule: true, requestPageOpen: true, approvalItems: 0, taskModule: true, tasksSwitch: true, taskPageOpen: true, taskItems: 0 };

describe("allowedCollabTabs", () => {
  it("gives a tab for each module the person has, even with nothing in it", () => {
    expect(allowedCollabTabs(full)).toEqual(["approvals", "tasks"]);
  });
  it("without a module, shows its tab only when the person collaborates on an item of it (D-434)", () => {
    expect(allowedCollabTabs({ ...full, approvalModule: false })).toEqual(["tasks"]);
    expect(allowedCollabTabs({ ...full, approvalModule: false, approvalItems: 2 })).toEqual(["approvals", "tasks"]);
    expect(allowedCollabTabs({ ...full, taskModule: false })).toEqual(["approvals"]);
    expect(allowedCollabTabs({ ...full, taskModule: false, taskItems: 1 })).toEqual(["approvals", "tasks"]);
  });
  it("a module switched off for everyone shows nothing, collaborations or not", () => {
    expect(allowedCollabTabs({ ...full, tasksSwitch: false, taskItems: 5 })).toEqual(["approvals"]);
  });
  it("a record page Hidden by page access hides its tab", () => {
    expect(allowedCollabTabs({ ...full, requestPageOpen: false, approvalItems: 3 })).toEqual(["tasks"]);
    expect(allowedCollabTabs({ ...full, taskPageOpen: false, taskItems: 3 })).toEqual(["approvals"]);
  });
  it("no module and no collaboration: no tab (the page is not found, the sidebar hides it)", () => {
    expect(allowedCollabTabs({ ...full, approvalModule: false, taskModule: false })).toEqual([]);
  });
});

describe("pickCollabTab", () => {
  it("opens the asked tab when the person has it", () => {
    expect(pickCollabTab({ tab: "tasks" }, ["approvals", "tasks"], {})).toBe("tasks");
    expect(pickCollabTab({ tab: "approvals" }, ["approvals", "tasks"], { tasks: 3 })).toBe("approvals");
  });
  it("a forced tab the person doesn't have falls back to the first allowed tab", () => {
    expect(pickCollabTab({ tab: "tasks" }, ["approvals"], { approvals: 0 })).toBe("approvals");
    expect(pickCollabTab({ tab: "approvals" }, ["tasks"], { tasks: 0 })).toBe("tasks");
  });
  it("any other address with filters is the Approvals list (old bookmarks, quick tabs, saved views)", () => {
    expect(pickCollabTab({ tab: "open" }, ["approvals", "tasks"], { tasks: 4 })).toBe("approvals");
    expect(pickCollabTab({ q: "PO", sort: "newest" }, ["approvals", "tasks"], { tasks: 4 })).toBe("approvals");
  });
  it("a bare address opens the first tab with items, else the first tab", () => {
    expect(pickCollabTab({}, ["approvals", "tasks"], { approvals: 0, tasks: 2 })).toBe("tasks");
    expect(pickCollabTab({}, ["approvals", "tasks"], { approvals: 1, tasks: 2 })).toBe("approvals");
    expect(pickCollabTab({}, ["approvals", "tasks"], {})).toBe("approvals");
    expect(pickCollabTab({ q: "" }, ["approvals", "tasks"], { tasks: 1 })).toBe("tasks");
  });
  it("no tab at all: null", () => {
    expect(pickCollabTab({ tab: "tasks" }, [], {})).toBeNull();
  });
  it("tab addresses carry only their own query", () => {
    expect(collabTabHref("tasks")).toBe("/users/collaborating?tab=tasks");
    expect(collabTabHref("tasks", { q: "x", page: 2, sortBy: null })).toBe("/users/collaborating?tab=tasks&q=x&page=2");
  });
});

describe("Commenter rights (D-434)", () => {
  const follower = taskRights({ isAssignee: false, isCreator: false, isFollower: true, managesAssignee: false, isAdmin: false, bestProjectRole: null, adhoc: true, isOriginalCreator: false });
  it("keep view, comment and like; nothing else", () => {
    const rights = commenterRights(follower, true);
    expect(rights).toMatchObject({ view: true, comment: true, like: true, edit: false, details: false, planning: false, progress: false, follow: false });
  });
  it("without the collaboration, nothing at all", () => {
    expect(commenterRights(follower, false)).toMatchObject({ view: false, comment: false, like: false });
  });
  it("a Commenter's task actions are COMMENT only, even when other rules would add more", () => {
    const task = { status: "OPEN" as const, createdBy: 1, assigneeId: 2, assignedBy: 1 };
    const viewer: TaskViewer = { id: 9, isAdmin: false, managesAssignee: true, workSee: true, workComment: true, workEdit: true, commenter: true };
    const settings = { allowBlocked: true, allowReopen: true, allowReassign: true, assigneeMayCancel: true };
    expect([...allowedTaskActions(task, viewer, settings)]).toEqual(["COMMENT"]);
    expect([...allowedTaskActions(task, { ...viewer, commenter: false }, settings)].length).toBeGreaterThan(1);
  });
});
