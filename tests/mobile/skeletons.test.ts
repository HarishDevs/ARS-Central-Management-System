import { describe, expect, it } from "vitest";
import { desktopSkeletonFor, skeletonFor } from "@/features/shell/NavigationProgress";

// v1.44.1: on phones, a page change lays the new screen's skeleton over the
// content (no new route loading.tsx: tests/ui/loading-guard.test.ts).
describe("skeletonFor", () => {
  it("gives each phone screen its own skeleton", () => {
    expect(skeletonFor("/users")).toBe("home");
    expect(skeletonFor("/users/approvals")).toBe("approvals");
    expect(skeletonFor("/users/work/my-tasks")).toBe("tasks");
    expect(skeletonFor("/users/inbox")).toBe("inbox");
    expect(skeletonFor("/users/more")).toBe("more");
    expect(skeletonFor("/users/requests/12")).toBe("request");
    expect(skeletonFor("/users/tasks/7")).toBe("task");
  });

  it("leaves pages with a reviewed loading.tsx to it", () => {
    for (const path of ["/users/new", "/users/help", "/users/profile/devices"]) expect(skeletonFor(path)).toBeNull();
  });

  it("gives other users pages the general skeleton, and nothing outside the users area", () => {
    expect(skeletonFor("/users/calendar")).toBe("page");
    expect(skeletonFor("/users/requests")).toBe("page");
    expect(skeletonFor("/users-guide")).toBeNull();
    expect(skeletonFor("/admin/users")).toBeNull();
  });
});

// v1.72.0 (D-387): a project and its settings get their own skeleton on a wide screen.
describe("desktopSkeletonFor", () => {
  it("picks the project or settings skeleton, and nothing elsewhere", () => {
    expect(desktopSkeletonFor("/users/work/projects/12")).toBe("project");
    expect(desktopSkeletonFor("/users/work/projects/12/settings")).toBe("settings");
    expect(desktopSkeletonFor("/users/work/projects")).toBeNull();
    expect(desktopSkeletonFor("/users/work/projects/12/forms/3")).toBeNull();
    expect(desktopSkeletonFor("/users/work/projects/new")).toBeNull();
  });
});
