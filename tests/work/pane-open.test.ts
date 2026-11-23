import { describe, expect, it } from "vitest";
import { paneCloseHref, paneHref, taskHref, taskIdFromHref } from "@/features/work/pane-open";
import { parsePaneMode, PANE_MODES } from "@/server/work/pm-rules";

// v1.83.0 (D-410): every task link is its own page; a plain click opens the side pane.
const ORIGIN = "https://approval.example";

describe("task links (D-410)", () => {
  it("recognises a task's own page on this site only", () => {
    expect(taskIdFromHref("/users/tasks/42", ORIGIN)).toBe(42);
    expect(taskIdFromHref("/users/tasks/42/", ORIGIN)).toBe(42);
    expect(taskIdFromHref("/users/tasks/42?created=1", ORIGIN)).toBe(42);
    expect(taskIdFromHref(`${ORIGIN}/users/tasks/7#c1`, ORIGIN)).toBe(7);
    expect(taskIdFromHref("/users/tasks/new", ORIGIN)).toBeNull();
    expect(taskIdFromHref("/users/tasks/assigned", ORIGIN)).toBeNull();
    expect(taskIdFromHref("/users/tasks", ORIGIN)).toBeNull();
    expect(taskIdFromHref("/users/tasks/42/edit", ORIGIN)).toBeNull();
    expect(taskIdFromHref("https://elsewhere.example/users/tasks/42", ORIGIN)).toBeNull();
    expect(taskIdFromHref("/users/work/my-tasks?task=42", ORIGIN)).toBeNull();
  });

  it("opens the pane on the current address and closes it without ?task", () => {
    expect(paneHref(5, { pathname: "/users/inbox", search: "" })).toBe("/users/inbox?task=5");
    expect(paneHref(5, { pathname: "/users", search: "?home=tasks&task=3" })).toBe("/users?home=tasks&task=5");
    expect(paneCloseHref("/users", { home: "tasks", task: "5" })).toBe("/users?home=tasks");
    expect(paneCloseHref("/users/tasks", { task: "5" })).toBe("/users/tasks");
    expect(paneCloseHref("/users/work/search", { q: "a b", status: ["open", "late"], task: "9" })).toBe("/users/work/search?q=a+b&status=open&status=late");
    expect(taskHref(12)).toBe("/users/tasks/12");
  });

  it("keeps the side pane unless the person chose the dialog", () => {
    expect(PANE_MODES).toEqual(["SIDE", "DIALOG"]);
    expect(parsePaneMode("DIALOG")).toBe("DIALOG");
    expect(parsePaneMode("SIDE")).toBe("SIDE");
    expect(parsePaneMode(null)).toBe("SIDE");
    expect(parsePaneMode("dialog")).toBe("SIDE");
  });
});
