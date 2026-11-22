import { describe, expect, it } from "vitest";
import {
  addableWidgets,
  addWidget,
  availableKinds,
  cleanNote,
  defaultLayout,
  greetingFor,
  greetingName,
  homeDate,
  MAX_WIDGETS,
  moveWidget,
  NOTE_MAX,
  placeWidget,
  readLayout,
  removeWidget,
  resizeWidget,
  validLayout,
  WIDGETS,
  type WidgetItem,
} from "@/server/home/widgets";

// v1.63.0 (D-369, PM-A12): Home widget rules.
const all = { tasks: true, projects: true };
const noProjects = { tasks: true, projects: false };
const noTasks = { tasks: false, projects: false };

describe("which widgets a person may have", () => {
  it("follows the modules: no Tasks, only the notepad; no Projects, nothing about projects", () => {
    expect(availableKinds(all)).toEqual(["my_tasks", "projects", "status_updates", "notepad", "workload", "assigned", "people"]);
    expect(availableKinds(noProjects)).not.toContain("projects");
    expect(availableKinds(noTasks)).toEqual(["notepad"]);
    // v1.66.0 (D-374): Forms came with phase C; it needs the "pm_forms" switch (and Tasks).
    expect(availableKinds(all)).not.toContain("forms");
    expect(WIDGETS.find((entry) => entry.kind === "forms")?.available).toBe(true);
    expect(availableKinds({ ...all, forms: true })).toContain("forms");
    expect(availableKinds({ ...noTasks, forms: true })).not.toContain("forms");
  });
  it("has no third-party names in titles or descriptions", () => {
    expect(WIDGETS.every((entry) => !/asana/i.test(`${entry.title} ${entry.description}`))).toBe(true);
  });
  it("starts with every allowed widget at its default width", () => {
    const layout = defaultLayout(all);
    expect(layout[0]).toEqual({ kind: "my_tasks", size: "full" });
    expect(layout.find((item) => item.kind === "notepad")?.size).toBe("half");
    expect(defaultLayout(noTasks)).toEqual([{ kind: "notepad", size: "half" }]);
  });
});

describe("layout validation", () => {
  it("accepts known widgets once each, with a size they offer", () => {
    expect(validLayout([{ kind: "notepad", size: "full" }, { kind: "my_tasks", size: "half" }], all)).toEqual([
      { kind: "notepad", size: "full" },
      { kind: "my_tasks", size: "half" },
    ]);
    expect(validLayout([], all)).toEqual([]);
  });
  it("refuses repeats, unknown kinds, other sizes, extra keys and widgets of modules the person lacks", () => {
    expect(validLayout([{ kind: "notepad", size: "half" }, { kind: "notepad", size: "full" }], all)).toBeNull();
    expect(validLayout([{ kind: "goals", size: "half" }], all)).toBeNull();
    expect(validLayout([{ kind: "notepad", size: "huge" }], all)).toBeNull();
    expect(validLayout([{ kind: "notepad", size: "half", html: "<b>" }], all)).toBeNull();
    expect(validLayout([{ kind: "projects", size: "half" }], noProjects)).toBeNull();
    expect(validLayout([{ kind: "my_tasks", size: "full" }], noTasks)).toBeNull();
    expect(validLayout([{ kind: "forms", size: "half" }], all)).toBeNull();
    expect(validLayout("notepad", all)).toBeNull();
    expect(validLayout(Array.from({ length: MAX_WIDGETS + 1 }, () => ({ kind: "notepad", size: "half" })), all)).toBeNull();
  });
  it("reads a stored layout leniently: drops unknown, repeated and no-longer-allowed widgets", () => {
    expect(readLayout(null, all)).toEqual(defaultLayout(all));
    expect(readLayout([{ kind: "projects", size: "full" }, { kind: "x" }, { kind: "projects", size: "half" }, { kind: "notepad", size: "half" }], noProjects)).toEqual([{ kind: "notepad", size: "half" }]);
    expect(readLayout([{ kind: "projects", size: "full" }], all)).toEqual([{ kind: "projects", size: "full" }]);
    // An empty stored layout stays empty (the person removed everything).
    expect(readLayout([], all)).toEqual([]);
  });
});

describe("changes", () => {
  const layout: WidgetItem[] = [
    { kind: "my_tasks", size: "full" },
    { kind: "notepad", size: "half" },
    { kind: "projects", size: "half" },
  ];
  it("moves by one (clamped), places before another, adds once, removes, resizes", () => {
    expect(moveWidget(layout, "notepad", -1).map((item) => item.kind)).toEqual(["notepad", "my_tasks", "projects"]);
    expect(moveWidget(layout, "my_tasks", -1)).toEqual(layout);
    expect(moveWidget(layout, "projects", 5).map((item) => item.kind)).toEqual(["my_tasks", "notepad", "projects"]);
    expect(placeWidget(layout, "projects", "my_tasks").map((item) => item.kind)).toEqual(["projects", "my_tasks", "notepad"]);
    expect(placeWidget(layout, "my_tasks", null).map((item) => item.kind)).toEqual(["notepad", "projects", "my_tasks"]);
    expect(addWidget(layout, "notepad")).toEqual(layout);
    expect(addWidget(layout, "people").at(-1)).toEqual({ kind: "people", size: "full" });
    expect(removeWidget(layout, "notepad").map((item) => item.kind)).toEqual(["my_tasks", "projects"]);
    expect(resizeWidget(layout, "notepad", "full")[1]).toEqual({ kind: "notepad", size: "full" });
  });
  it("offers only allowed widgets not on Home yet", () => {
    expect(addableWidgets(layout, all).map((entry) => entry.kind)).toEqual(["status_updates", "workload", "assigned", "people"]);
    expect(addableWidgets([], noTasks).map((entry) => entry.kind)).toEqual(["notepad"]);
  });
});

describe("greeting and notepad", () => {
  it("greets by the hour in India", () => {
    expect(greetingFor(new Date("2026-11-22T03:00:00Z"))).toBe("Good morning"); // 08:30 IST
    expect(greetingFor(new Date("2026-11-22T08:00:00Z"))).toBe("Good afternoon"); // 13:30 IST
    expect(greetingFor(new Date("2026-11-22T13:00:00Z"))).toBe("Good evening"); // 18:30 IST
    expect(homeDate(new Date("2026-11-22T20:00:00Z"))).toMatch(/Monday.*23 November|23 November.*Monday/);
    expect(greetingName("Harish Kumar")).toBe("Harish Kumar");
    expect(greetingName("  Sita   Devi Rao ")).toBe("Sita");
  });
  it("keeps a note up to 50,000 characters, as text without control characters", () => {
    expect(cleanNote("a\r\nb\u0007")).toBe("a\nb");
    expect(cleanNote("x".repeat(NOTE_MAX))).toHaveLength(NOTE_MAX);
    expect(cleanNote("x".repeat(NOTE_MAX + 1))).toBeNull();
    expect(cleanNote(5)).toBeNull();
  });
});
