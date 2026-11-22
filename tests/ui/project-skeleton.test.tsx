import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectSettingsSkeleton, ProjectSkeleton } from "@/features/ui/Skeleton";

// v1.72.0 (D-387, COMPONENT_SPECS §8): the project skeletons mirror the real
// layout and say "Loading" once to screen readers; the blocks are hidden
// from them and use the .skeleton class (static under reduced motion).
describe("ProjectSkeleton", () => {
  const html = renderToStaticMarkup(<ProjectSkeleton />);
  it("is busy, announced once, and its blocks are hidden from screen readers", () => {
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain("Loading the project…");
    const blocks = html.match(/class="skeleton[^"]*"/g) ?? [];
    expect(blocks.length).toBeGreaterThan(30);
    expect(html.match(/aria-hidden="true" class="skeleton/g)?.length).toBe(blocks.length);
  });
  it("draws two sections of task rows with a circle each", () => {
    expect(html.match(/rounded-full" style="width/g)).toBeNull();
    expect(html.match(/h-4 w-4 shrink-0 rounded-full/g)).toHaveLength(6);
  });
});

describe("ProjectSettingsSkeleton", () => {
  it("is busy and announced", () => {
    const html = renderToStaticMarkup(<ProjectSettingsSkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading the project&#x27;s settings…");
  });
});
