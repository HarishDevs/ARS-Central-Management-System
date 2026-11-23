import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReturnTo, returnParam } from "@/lib/nav/return-to";
import { closeHow, sameAddress } from "@/features/ui/pane-close";
import { listHref, MOTION_DISTANCE, MOTION_DURATION, MOTION_EASE, originFor, ORIGIN_TTL_MS } from "@/features/shell/motion-rules";
import { FOLD_TTL_MS, parseFold } from "@/features/ui/fold-memory";

// v1.87.0 (D-417): navigation continuity rules (return-to, pane close, list
// origin, fold memory) and the motion tokens kept in step with globals.css.

describe("parseReturnTo: a validated way back", () => {
  const all = () => true;
  it("accepts Admin → Records with its query, for someone who may open Admin", () => {
    expect(parseReturnTo("/admin/records/requests?q=Audit&dir=asc&open=1", all)).toEqual({ href: "/admin/records/requests?q=Audit&dir=asc&open=1", label: "Admin → Records", area: "admin" });
    expect(parseReturnTo("/admin", all)?.label).toBe("Admin → Overview");
    expect(parseReturnTo("/admin/insights/reports", all)?.label).toBe("Admin → Insights");
  });
  it("refuses an area the person can't open (server check passed in)", () => {
    expect(parseReturnTo("/admin/records/requests", (area) => area === "users")).toBeNull();
  });
  it("refuses other sites, protocol-relative, backslashes, schemes and control characters", () => {
    for (const bad of ["https://evil.example/admin", "//evil.example/admin/records/x", "/\\evil.example", "javascript:alert(1)", "/admin/records/x\n", "admin/records/x", "", "/admin/records/x#frag"]) {
      expect(parseReturnTo(bad, all), bad).toBeNull();
    }
  });
  it("refuses paths outside the allow-list and dot tricks", () => {
    for (const bad of ["/users/requests/1", "/admin/users", "/admin/records/", "/admin/../users/queue", "/admin/records/../../superadmin/security", "/adminx", "/superadmin/security"]) {
      expect(parseReturnTo(bad, all), bad).toBeNull();
    }
  });
  it("refuses non-strings and very long values", () => {
    expect(parseReturnTo(undefined, all)).toBeNull();
    expect(parseReturnTo(["/admin"], all)).toBeNull();
    expect(parseReturnTo(`/admin/records/requests?q=${"a".repeat(700)}`, all)).toBeNull();
  });
  it("builds the ?from= value from the current address", () => {
    expect(returnParam({ pathname: "/admin/records/requests", search: "?q=a b&open=2" })).toBe("from=%2Fadmin%2Frecords%2Frequests%3Fq%3Da+b%26open%3D2");
  });
});

describe("closeHow: closing a pane adds no history entry", () => {
  it("goes back when the entry before is the same screen without the pane, reached forwards", () => {
    expect(closeHow({ prev: "/users/work/my-tasks?sort=due", curr: "/users/work/my-tasks?sort=due&task=4", pop: false }, "/users/work/my-tasks?sort=due&task=4", "/users/work/my-tasks?sort=due")).toBe("back");
  });
  it("replaces after Back/Forward, a fresh load, or when the entry before is another page", () => {
    expect(closeHow({ prev: "/users/work/my-tasks", curr: "/users/work/my-tasks?task=4", pop: true }, "/users/work/my-tasks?task=4", "/users/work/my-tasks")).toBe("replace");
    expect(closeHow({ prev: null, curr: "/users/work/my-tasks?task=4", pop: false }, "/users/work/my-tasks?task=4", "/users/work/my-tasks")).toBe("replace");
    expect(closeHow({ prev: "/users/queue", curr: "/users/work/my-tasks?task=4", pop: false }, "/users/work/my-tasks?task=4", "/users/work/my-tasks")).toBe("replace");
  });
  it("compares addresses with their query in any order and either space spelling", () => {
    expect(sameAddress("/a?x=1&y=a+b", "/a?y=a%20b&x=1")).toBe(true);
    expect(sameAddress("/a?x=1", "/a?x=2")).toBe(false);
    expect(sameAddress(null, "/a")).toBe(false);
  });
});

describe("list origin for breadcrumbs", () => {
  const now = 1_000_000;
  it("drops pane parameters from the remembered list", () => {
    expect(listHref({ pathname: "/users/queue", search: "?sortBy=title&dir=asc&task=3&open=9" })).toBe("/users/queue?sortBy=title&dir=asc");
    expect(listHref({ pathname: "/users/queue", search: "" })).toBe("/users/queue");
  });
  it("uses the remembered list only for the same page, fresh and on this site", () => {
    const raw = (href: string, at = now) => JSON.stringify({ href, at });
    expect(originFor("/users/queue", raw("/users/queue?sortBy=title&dir=asc"), now)).toBe("/users/queue?sortBy=title&dir=asc");
    expect(originFor("/users/queue", raw("/users/requests?x=1"), now)).toBe("/users/queue");
    expect(originFor("/users/queue", raw("//evil.example/users/queue"), now)).toBe("/users/queue");
    expect(originFor("/users/queue", raw("/users/queue?a=1", now - ORIGIN_TTL_MS - 1), now)).toBe("/users/queue");
    expect(originFor("/users/queue", "not json", now)).toBe("/users/queue");
    expect(originFor("/users/queue", null, now)).toBe("/users/queue");
  });
});

describe("fold memory", () => {
  it("reads a saved state and drops old or odd ones", () => {
    const now = 5_000_000;
    expect(parseFold(JSON.stringify({ closed: true, toggled: ["Today", 3], at: now }), now)).toEqual({ closed: true, toggled: ["Today"] });
    expect(parseFold(JSON.stringify({ closed: true, toggled: [], at: now - FOLD_TTL_MS - 1 }), now)).toBeNull();
    expect(parseFold(JSON.stringify({ closed: "yes", toggled: [], at: now }), now)).toBeNull();
    expect(parseFold("{", now)).toBeNull();
  });
});

describe("motion tokens: one scale, CSS and TS in step", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "styles/globals.css"), "utf8");
  const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf("--motion-instant")));
  const value = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1]?.trim();
  it("has the owner's durations", () => {
    expect([value("--motion-instant"), value("--motion-fast"), value("--motion-base"), value("--motion-moderate"), value("--motion-slow"), value("--motion-slower")]).toEqual(["100ms", "150ms", "220ms", "280ms", "350ms", "450ms"]);
    expect(Object.values(MOTION_DURATION)).toEqual([100, 150, 220, 280, 350, 450]);
  });
  it("has the owner's easings", () => {
    expect(value("--ease-standard")).toBe(MOTION_EASE.standard);
    expect(value("--ease-enter")).toBe(MOTION_EASE.enter);
    expect(value("--ease-exit")).toBe(MOTION_EASE.exit);
  });
  it("has the distances", () => {
    expect([1, 2, 3, 4, 5, 6].map((step) => value(`--motion-distance-${step}`))).toEqual(Object.values(MOTION_DISTANCE).map((px) => `${px}px`));
  });
  it("points the old names at the new scale (one system, no second set of values)", () => {
    for (const old of ["--motion-hover", "--motion-menu", "--motion-dialog-in", "--motion-dialog-out", "--motion-page", "--ease-out"]) expect(value(old), old).toMatch(/^var\(--(motion|ease)-/);
  });
  it("never animates `all` in the app's styles and code", () => {
    expect(css).not.toMatch(/transition:\s*all\b/);
    const files = ["features", "app"].flatMap((dir) => walk(path.join(process.cwd(), dir))).filter((file) => /\.(tsx|ts|css)$/.test(file));
    const offenders = files.filter((file) => /\btransition-all\b|transition:\s*all\b/.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("turns the shared motion classes off under reduced motion", () => {
    const reduced = css.slice(css.indexOf("/* v1.87.0 (D-417): reduced motion"));
    for (const name of [".motion-fade-in", ".motion-slide-up", ".motion-scale-in", ".motion-expand", ".motion-stagger"]) expect(reduced, name).toContain(name);
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}
