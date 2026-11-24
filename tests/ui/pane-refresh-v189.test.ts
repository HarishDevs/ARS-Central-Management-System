import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// v1.89.0 stage 4 (D-426, e2e v162 root cause): with a Suspense boundary around the side
// pane's task details, a refresh after an action in the pane never committed (the pane kept
// the old state, its buttons stayed busy). The layout guard of PERF-02 is PaneReserve.
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("the task pane refreshes after an action (D-426)", () => {
  it("TaskPane has no Suspense boundary around the details", () => {
    const pane = read("features/work/TaskPane.tsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(pane).not.toMatch(/<Suspense\b/);
  });
  it("the pane's room is still reserved before the screen (PERF-02)", () => {
    expect(read("app/users/layout.tsx")).toMatch(/PaneReserve/);
  });
  it("Undo after Mark complete shows the task open itself", () => {
    expect(read("features/work/client.tsx")).toMatch(/undone\?\.ok && setShown\(false\)/);
  });
});
