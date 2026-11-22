import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextRowIndex, PLACE_TTL_MS, readPlace, transitionKind } from "@/features/shell/motion-rules";
import { swipeShouldClose, SWIPE_CLOSE_PX } from "@/features/ui/swipe";
import { desktopSkeletonFor } from "@/features/shell/NavigationProgress";
import { nextWaitingHref } from "@/features/requests/next-waiting";
import { plainText } from "@/features/requests/comment-text";
import { successToastMs } from "@/features/ui/form";
import { closeTopLayer } from "@/features/ui/top-layer";
import { PageHeader } from "@/features/shell/PageHeader";
import { findSettingDefinition } from "@/server/settings/definitions";
import { ListTodo } from "lucide-react";

// v1.80.0 (D-407): the owner-approved interaction, motion and loading review.
const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "styles/globals.css"), "utf8");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

describe("page transitions (point 4)", () => {
  const here = { href: "http://localhost/users/queue?page=2" };
  it("moves a request's title into the heading when opened from a list row", () => {
    expect(transitionKind({ href: "/users/requests/12", inRow: true }, here)).toBe("title");
    expect(transitionKind({ href: "/users/tickets/4", inRow: true }, here)).toBe("title");
  });
  it("cross-fades every other internal page change", () => {
    expect(transitionKind({ href: "/users/requests/12" }, here)).toBe("fade");
    expect(transitionKind({ href: "/users/queue?page=3" }, here)).toBe("fade");
    expect(transitionKind({ href: "/users/work/my-tasks", inRow: true }, here)).toBe("fade");
  });
  it("never animates the API, downloads, new tabs, other sites or the same address", () => {
    expect(transitionKind({ href: "/api/requests/1/summary.pdf" }, here)).toBeNull();
    expect(transitionKind({ href: "/users/requests/1", download: true }, here)).toBeNull();
    expect(transitionKind({ href: "/users/requests/1", target: "_blank" }, here)).toBeNull();
    expect(transitionKind({ href: "https://example.com/users" }, here)).toBeNull();
    expect(transitionKind({ href: "/users/queue?page=2" }, here)).toBeNull();
  });
  it("is a Super Admin switch, off by default", () => {
    const definition = findSettingDefinition("features.page_transitions");
    expect(definition?.defaultValue).toBe("OFF");
    expect(definition?.group).toBe("FEATURES");
  });
});

describe("keyboard flow (point 13)", () => {
  it("j / k move one row and stop at the ends", () => {
    expect(nextRowIndex(0, -1, "j")).toBeNull();
    expect(nextRowIndex(5, -1, "j")).toBe(0);
    expect(nextRowIndex(5, -1, "k")).toBe(4);
    expect(nextRowIndex(5, 2, "j")).toBe(3);
    expect(nextRowIndex(5, 4, "j")).toBe(4);
    expect(nextRowIndex(5, 0, "k")).toBe(0);
  });
  it("lands on the next request waiting, remembering the one decided", () => {
    expect(nextWaitingHref(42, 7)).toBe("/users/requests/42?nextwaiting=1&after=7");
  });
});

describe("keep people's place (point 12)", () => {
  it("reads a remembered place, ignoring stale or odd values", () => {
    const now = 1_000_000_000;
    expect(readPlace(JSON.stringify({ y: 840, href: "/users/requests/3", at: now - 1000 }), now)).toEqual({ y: 840, href: "/users/requests/3", at: now - 1000 });
    expect(readPlace(JSON.stringify({ y: 840, href: "/users/requests/3", at: now - PLACE_TTL_MS - 1 }), now)).toBeNull();
    expect(readPlace(JSON.stringify({ y: -5, href: "javascript:alert(1)", at: now }), now)).toEqual({ y: 0, href: null, at: now });
    expect(readPlace("not json", now)).toBeNull();
    expect(readPlace(null, now)).toBeNull();
  });
});

describe("swipe down to close a bottom sheet (point 14)", () => {
  it("closes when pulled far enough or flicked, never when pushed up", () => {
    expect(swipeShouldClose(SWIPE_CLOSE_PX, 600)).toBe(true);
    expect(swipeShouldClose(40, 120)).toBe(true);
    expect(swipeShouldClose(40, 600)).toBe(false);
    expect(swipeShouldClose(10, 50)).toBe(false);
    expect(swipeShouldClose(-120, 100)).toBe(false);
  });
});

describe("desktop skeletons (point 8)", () => {
  it("gives the lists a table skeleton on a wide screen", () => {
    for (const page of ["/users/queue", "/users/queue/sent-back", "/users/requests", "/users/approved", "/users/inbox", "/users/tasks", "/superadmin/audit"]) expect(desktopSkeletonFor(page)).toBe("table");
    expect(desktopSkeletonFor("/users/requests/12")).toBeNull();
    expect(desktopSkeletonFor("/users")).toBeNull();
  });
});

describe("one feedback kind per event (point 10) and optimistic comments (point 9)", () => {
  it("keeps a success toast up longer for longer words", () => {
    expect(successToastMs("Saved.")).toBe(5000);
    expect(successToastMs("x".repeat(140))).toBe(9000);
    expect(successToastMs("x".repeat(2000))).toBe(12000);
  });
  it("previews a comment's words without its markup", () => {
    expect(plainText("<p>Hello <strong>team</strong></p><p>&lt;b&gt; &amp; more</p>")).toBe("Hello team\n<b> & more");
  });
});

describe("dialogs close with their animation (point 1)", () => {
  it("in a browser without top-layer exit animations, closes after a closing step", async () => {
    const attributes = new Set<string>();
    let closed = false;
    const element = {
      open: true,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string) => void attributes.add(name),
      removeAttribute: (name: string) => void attributes.delete(name),
      getAnimations: () => [{ finished: Promise.resolve() }],
      close: () => {
        closed = true;
      },
    } as unknown as HTMLDialogElement;
    await closeTopLayer(element);
    expect(closed).toBe(true);
    expect(attributes.has("data-closing")).toBe(false);
  });
});

describe("one motion system (globals.css)", () => {
  it("has the motion tokens of the brief", () => {
    for (const [name, value] of [["--motion-hover", "120ms"], ["--motion-menu", "190ms"], ["--motion-dialog-in", "220ms"], ["--motion-dialog-out", "160ms"], ["--motion-page", "120ms"]]) expect(css).toContain(`${name}: ${value};`);
  });
  it("animates dialogs with @starting-style, allow-discrete and overlay, and the closing step", () => {
    expect(css).toContain("transition-property: opacity, transform, display, overlay;");
    expect(css).toContain("transition-behavior: allow-discrete;");
    expect(css).toMatch(/@starting-style\s*\{\s*dialog\.ars-dialog/);
    expect(css).toContain(":where(:not([data-closing]))");
  });
  it("moves nothing for reduce motion (fades of 100 ms or less)", () => {
    const reduce = css.split("@media (prefers-reduced-motion: reduce)").slice(1).join("\n");
    expect(reduce).toContain("animation: none !important");
    expect(reduce).toContain("transition-duration: 100ms !important");
    expect(reduce).toContain("animation: fade-in-only 100ms linear !important");
  });
  it("only animates opacity and transform in the new motion block", () => {
    const block = css.slice(css.indexOf("---- v1.80.0 (D-407)"));
    const properties = [...block.matchAll(/transition(?:-property)?:\s*([^;]+);/g)].flatMap((match) => match[1]!.split(",").map((part) => part.trim().split(/\s+/)[0]!));
    for (const property of properties) expect(["opacity", "transform", "translate", "rotate", "display", "overlay", "background-color", "outline-color", "none", "block-size"]).toContain(property);
  });
});

describe("first-review points", () => {
  it("drops all-caps labels (only typed codes, the Classic view and the brand lockup keep capitals)", () => {
    const allowed = ["ModuleTypeEditor.tsx", "TicketCategoryForm.tsx", "Classic.tsx", "Brand.tsx", "BrandLoader.tsx", "AuthLayout.tsx", "LandingWelcome.tsx"];
    const offenders = [...sources(path.join(root, "features")), ...sources(path.join(root, "app"))]
      .filter((file) => !allowed.includes(path.basename(file)))
      .filter((file) => readFileSync(file, "utf8").split("\n").some((line) => /\buppercase\b/.test(line) && !line.trim().startsWith("//")));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
  it("uses the 12 / 14 / 16 / 20 / 28 type scale", () => {
    const tailwind = readFileSync(path.join(root, "tailwind.config.ts"), "utf8");
    for (const [name, size] of [["micro", 12], ["caption", 12], ["label", 14], ["body", 14], ["subhead", 16], ["title", 20], ["greeting", 28]] as const) expect(tailwind).toMatch(new RegExp(`${name}: \\["calc\\(${size}px`));
  });
  it("draws no icon tile in the page header", () => {
    const html = renderToStaticMarkup(<PageHeader title="Waiting for me" icon={ListTodo} />);
    expect(html).not.toContain("page-icon");
    expect(html).toContain("<h1");
  });
  it("keeps every token pair at AA in light and dark (scripts/qa/token-contrast.mjs)", () => {
    const output = execFileSync(process.execPath, [path.join(root, "scripts/qa/token-contrast.mjs")], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output.match(/^ok /gm)?.length).toBeGreaterThanOrEqual(60);
  });
});
