import { describe, expect, it } from "vitest";
import { TOUR_STEPS, tourStepsFor } from "@/features/help/tour-steps";

// v1.14.0 (D-167): the onboarding tour's steps.
describe("onboarding tour steps", () => {
  it("covers approvals, tasks and the calendar, from welcome to finish", () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(ids[0]).toBe("welcome");
    expect(ids.at(-1)).toBe("finish");
    for (const id of ["overview", "inbox", "create", "new-request", "custom", "queue", "my-requests", "tasks", "new-task", "projects", "calendar", "google-calendar", "notifications", "search", "profile", "out-of-office", "meetings"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of ["Approvals", "Tasks", "Calendar"]) expect(TOUR_STEPS.some((step) => step.section === section)).toBe(true);
  });

  it("every step says something, and every page it opens is in the user space", () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.intro.length).toBeGreaterThan(10);
      expect(step.points.length).toBeGreaterThan(0);
      if (step.path) expect(step.path).toMatch(/^\/users(\/|$)/);
    }
  });

  it("leaves out steps whose page is hidden from the person", () => {
    // D-249: Tasks & projects live under /users/work.
    const steps = tourStepsFor((path) => !path.startsWith("/users/work"));
    expect(steps.map((step) => step.id)).not.toContain("tasks");
    expect(steps.map((step) => step.id)).not.toContain("new-task");
    expect(steps.map((step) => step.id)).not.toContain("projects");
    expect(steps.map((step) => step.id)).toContain("notifications"); // no page of its own
    expect(tourStepsFor(() => true)).toHaveLength(TOUR_STEPS.length);
  });

  it("the Projects step mentions Starred projects and Undo (v1.62.0, D-368)", () => {
    const points = TOUR_STEPS.find((step) => step.id === "projects")?.points.join(" ") ?? "";
    expect(points).toContain("Starred");
    expect(points).toContain("Undo");
  });

  it("the Projects step mentions custom fields and Add field (v1.64.0, D-371)", () => {
    const points = TOUR_STEPS.find((step) => step.id === "projects")?.points.join(" ") ?? "";
    expect(points).toContain("Add field");
    expect(points).toContain("custom fields");
  });

  it("the Projects step mentions the Gantt and dependencies (v1.65.0, D-373)", () => {
    const points = TOUR_STEPS.find((step) => step.id === "projects")?.points.join(" ") ?? "";
    expect(points).toContain("Gantt");
    expect(points).toContain("Blocked by");
  });

  it("the Projects step mentions project forms (v1.66.0, D-374)", () => {
    const points = TOUR_STEPS.find((step) => step.id === "projects")?.points.join(" ") ?? "";
    expect(points).toContain("Add a form");
    expect(points).toContain("QR code");
  });

  it("the Projects step mentions the Dashboard and Workload tabs (v1.67.0, D-375)", () => {
    const points = TOUR_STEPS.find((step) => step.id === "projects")?.points.join(" ") ?? "";
    expect(points).toContain("Dashboard");
    expect(points).toContain("Workload");
    expect(points).toContain("View as table");
  });

  it("the Projects step mentions automations and the run log (v1.68.0, D-380)", () => {
    const points = TOUR_STEPS.find((step) => step.id === "projects")?.points.join(" ") ?? "";
    expect(points).toContain("automations");
    expect(points).toContain("Run log");
  });

  it("Home mentions Customise and the private notepad, and My Tasks its own tabs (v1.63.0, D-369)", () => {
    const home = TOUR_STEPS.find((step) => step.id === "overview")?.points.join(" ") ?? "";
    expect(home).toContain("Customise");
    expect(home).toContain("Private notepad");
    expect(TOUR_STEPS.find((step) => step.id === "tasks")?.points.join(" ")).toContain("Save view");
  });
});
