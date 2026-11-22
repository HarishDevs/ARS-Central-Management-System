import { describe, expect, it } from "vitest";
import { approvalsDesktopHref, approvalsPhoneTab, latestLimit, legacyTaskHref, projectTemplatesHref, queryHrefMatches } from "@/features/shell/nav-routes";
import { SWITCHED_OFF_LABEL, switchedOffHref, switchedOffLabel } from "@/features/shell/switched-off";
import { isBareQuery, sameListReferer } from "@/server/lists/views";
import { locate } from "@/features/shell/classic-modules";

// v1.72.1 (D-395): the QA review of state screens and navigation.
describe("default list views: Clear reaches the unfiltered list (F-01)", () => {
  it("only an empty address is a bare opening", () => {
    expect(isBareQuery({})).toBe(true);
    expect(isBareQuery({ q: "", page: undefined })).toBe(true);
    expect(isBareQuery({ q: "x" })).toBe(false);
  });
  it("coming from the same list (pressing Clear) skips the default view", () => {
    expect(sameListReferer("http://localhost:3100/users/queue?show=overdue", "/users/queue")).toBe(true);
    expect(sameListReferer("http://localhost:3100/users/requests", "/users/queue")).toBe(false);
    expect(sameListReferer(null, "/users/queue")).toBe(false);
    expect(sameListReferer("not a url", "/users/queue")).toBe(false);
  });
});

describe("/users/approvals?tab= respects what the person can open (F-03)", () => {
  const all = { queue: true, mine: true, approved: true };
  it("opens the matching list on a computer", () => {
    expect(approvalsDesktopHref(undefined, all)).toBe("/users/queue");
    expect(approvalsDesktopHref("waiting", all)).toBe("/users/queue");
    expect(approvalsDesktopHref("mine", all)).toBe("/users/requests");
    expect(approvalsDesktopHref("approved", all)).toBe("/users/approved");
    expect(approvalsDesktopHref("drafts", all)).toBe("/users?drafts=all");
    expect(approvalsDesktopHref("nonsense", all)).toBe("/users/queue");
  });
  it("never sends someone to a list hidden from them", () => {
    expect(approvalsDesktopHref("waiting", { queue: false, mine: true, approved: true })).toBe("/users/requests");
    expect(approvalsDesktopHref(undefined, { queue: false, mine: true, approved: true })).toBe("/users/requests");
    expect(approvalsDesktopHref("approved", { queue: true, mine: true, approved: false })).toBe("/users/queue");
    expect(approvalsDesktopHref("mine", { queue: false, mine: false, approved: false })).toBe("/users");
  });
  it("picks an allowed phone tab", () => {
    expect(approvalsPhoneTab("waiting", { queue: false, mine: true })).toBe("mine");
    expect(approvalsPhoneTab("drafts", { queue: true, mine: false })).toBe("waiting");
    expect(approvalsPhoneTab("approved", { queue: true, mine: true })).toBe("approved");
    expect(approvalsPhoneTab(undefined, { queue: true, mine: true })).toBe("waiting");
  });
});

describe("routes", () => {
  it("old /users/work?task=N links open the task (F-05)", () => {
    expect(legacyTaskHref("42")).toBe("/users/tasks/42");
    expect(legacyTaskHref("0")).toBeNull();
    expect(legacyTaskHref("4x")).toBeNull();
    expect(legacyTaskHref(["42"])).toBeNull();
    expect(legacyTaskHref(undefined)).toBeNull();
  });
  it("one Project templates destination (F-11)", () => {
    expect(projectTemplatesHref(true)).toBe("/users/work/templates");
    expect(projectTemplatesHref(false)).toBe("/users/work/projects?show=templates");
  });
  it("a menu entry with a query is lit only on the same values (F-12)", () => {
    const search = new URLSearchParams("create=task&x=1");
    expect(queryHrefMatches("/users/work/my-tasks?create=task", "/users/work/my-tasks", search)).toBe(true);
    expect(queryHrefMatches("/users/work/my-tasks?create=task", "/users/work/my-tasks", new URLSearchParams())).toBe(false);
    expect(queryHrefMatches("/users/work/my-tasks?create=task", "/users/tasks", search)).toBe(false);
    expect(queryHrefMatches("/users/work/my-tasks", "/users/work/my-tasks", search)).toBe(false);
  });
  it("the Classic view lights New task on the Create task window (F-12)", () => {
    const modules = [{ key: "tasks", label: "Tasks", hotkey: "", href: "/users/menu/tasks", pages: [{ href: "/users/tasks/new", label: "New task", activeOn: "/users/work/my-tasks?create=task" }, { href: "/users/work/my-tasks", label: "Task Summary" }] }];
    expect(locate(modules, "/users/work/my-tasks", new URLSearchParams("create=task")).page?.label).toBe("New task");
    expect(locate(modules, "/users/work/my-tasks", new URLSearchParams()).page?.label).toBe("Task Summary");
  });
  it("latest-N lists load more in steps, up to a ceiling (F-07)", () => {
    expect(latestLimit(undefined, 200, 1000)).toBe(200);
    expect(latestLimit("400", 200, 1000)).toBe(400);
    expect(latestLimit("250", 200, 1000)).toBe(400);
    expect(latestLimit("5", 200, 1000)).toBe(200);
    expect(latestLimit("99999", 200, 1000)).toBe(1000);
    expect(latestLimit("abc", 200, 1000)).toBe(200);
  });
});

describe("switched-off screen (F-04)", () => {
  it("names known features only", () => {
    expect(switchedOffHref("tasks")).toBe("/users/switched-off?feature=tasks");
    expect(switchedOffLabel("tasks")).toBe("Tasks");
    expect(switchedOffLabel("pm_portfolios")).toBe("Portfolios");
    expect(switchedOffLabel("__proto__")).toBeNull();
    expect(switchedOffLabel("<script>")).toBeNull();
    expect(switchedOffLabel(undefined)).toBeNull();
    expect(Object.keys(SWITCHED_OFF_LABEL).sort()).toEqual(["ai", "analytics", "information", "pm_extras", "pm_portfolios", "tasks"]);
  });
});
