import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaOfPath, landingFor, returnAddress, safeNextPath } from "@/lib/http/safe-next";
import { buildCsp, keepsLocalHttp } from "@/lib/security/csp";
import { originWay, ORIGIN_TTL_MS } from "@/features/shell/motion-rules";
import { backStaysInApp } from "@/features/ui/pane-close";
import { leavesPane } from "@/features/ui/pane-draft";
import { areaTitleMetadata } from "@/server/authorization/area-metadata";
import { returnToFor } from "@/server/authorization/return-to";
import { evaluateAreaAccess } from "@/server/authorization/policy";
import type { AuthenticatedUser, RoleCode } from "@/types/auth";

// v1.89.0 (D-419): the navigation audit's fixes (docs/qa/NAVIGATION-AUDIT.md, NAV-01..08)
// and the local-http CSP rule for the WebKit e2e runs.
const root = path.resolve(__dirname, "../..");
const person = (roles: RoleCode[], active = true): AuthenticatedUser => ({ id: 7, loginId: "P", name: "P", email: "p@example.test", whatsappNumber: null, signInMethod: "GOOGLE", active, roles, modules: [], chatModes: [], salesforceScope: "NONE" });
const staff = person(["USER"]);
const admin = person(["USER", "IT_ADMIN"]);
const superAdmin = person(["USER", "IT_ADMIN", "SUPER_ADMIN"]);
const can = (user: AuthenticatedUser) => (area: "users" | "admin" | "superadmin") => evaluateAreaAccess(user, area).allowed;

describe("NAV-02: the address to come back to keeps the query, safely", () => {
  it("keeps path and query (task pane, view, filters, sort)", () => {
    expect(returnAddress("/users/work/my-tasks", "?view=list&task=12")).toBe("/users/work/my-tasks?view=list&task=12");
    expect(returnAddress("/admin/users", "?q=abc&sortBy=login&dir=desc")).toBe("/admin/users?q=abc&sortBy=login&dir=desc");
    expect(returnAddress("/admin/users", "q=abc")).toBe("/admin/users?q=abc");
    expect(returnAddress("/users/inbox", "")).toBe("/users/inbox");
    expect(returnAddress("/users/inbox", "?")).toBe("/users/inbox");
  });
  it("never leaves the site (open redirects refused)", () => {
    expect(returnAddress("//evil.example", "?a=1")).toBe("/users");
    expect(returnAddress("/\\evil.example", "")).toBe("/users");
    expect(returnAddress("https://evil.example/x", "")).toBe("/users");
    expect(returnAddress("/users/x", "?a=1\nb")).toBe("/users/x");
    expect(safeNextPath(`/signed-out?next=${encodeURIComponent("//evil.example")}`)).toBe("/signed-out?next=%2F%2Fevil.example");
  });
  it("an address too long for ?next= falls back to the path alone", () => {
    expect(returnAddress("/users/search", `?q=${"x".repeat(600)}`)).toBe("/users/search");
  });
  it("SessionWatch and the middleware both use it (no path-only next left)", () => {
    const watch = fs.readFileSync(path.join(root, "features/shell/SessionWatch.tsx"), "utf8");
    const middleware = fs.readFileSync(path.join(root, "middleware.ts"), "utf8");
    expect(watch).toMatch(/returnAddress\(window\.location\.pathname/);
    expect(watch).not.toMatch(/next=\$\{encodeURIComponent\(pathname\)\}/);
    expect(middleware).toMatch(/searchParams\.set\("next", returnAddress\(pathname, request\.nextUrl\.search\)\)/);
  });
});

describe("NAV-07: sign-in lands in an area the person may open", () => {
  it("knows the area of a path", () => {
    expect(areaOfPath("/admin")).toBe("admin");
    expect(areaOfPath("/admin/users?q=1")).toBe("admin");
    expect(areaOfPath("/superadmin/monitoring/audit")).toBe("superadmin");
    expect(areaOfPath("/administrator")).toBe("users");
    expect(areaOfPath("/users/inbox")).toBe("users");
  });
  it("a User with ?next= to Admin or Super Admin lands on their home page", () => {
    expect(landingFor("/admin/users", can(staff))).toBe("/users");
    expect(landingFor("/superadmin", can(staff))).toBe("/users");
    expect(landingFor("/superadmin/security/pages", can(admin))).toBe("/users");
  });
  it("someone with the role still lands on the page asked for, with its query", () => {
    expect(landingFor("/admin/users?q=x", can(admin))).toBe("/admin/users?q=x");
    expect(landingFor("/superadmin/security/pages", can(superAdmin))).toBe("/superadmin/security/pages");
    expect(landingFor("/users/work/my-tasks?task=3", can(staff))).toBe("/users/work/my-tasks?task=3");
  });
  it("an unsafe or missing next is home; an inactive person never gets an area", () => {
    expect(landingFor("//evil.example", can(admin))).toBe("/users");
    expect(landingFor(undefined, can(admin))).toBe("/users");
    expect(landingFor("/admin", can(person(["USER", "IT_ADMIN"], false)))).toBe("/users");
  });
  it("the login page decides on the server; the sign-in panel goes through it", () => {
    const login = fs.readFileSync(path.join(root, "app/(public)/login/page.tsx"), "utf8");
    const panel = fs.readFileSync(path.join(root, "features/auth/components/SignInPanel.tsx"), "utf8");
    expect(login).toMatch(/landingFor\(raw, \(area\) => evaluateAreaAccess\(session\.user, area\)\.allowed\)/);
    expect(panel).toMatch(/\/login\?next=\$\{encodeURIComponent\(safe\)\}/);
  });
});

describe("NAV-01: a refused area never names its pages", () => {
  it("refused: every page title becomes the plain app name (template without %s)", () => {
    const refused = areaTitleMetadata(false);
    expect(refused.title).toEqual({ absolute: "ARS CMS", template: "ARS CMS" });
    const template = (refused.title as { template: string }).template;
    expect(template.includes("%s")).toBe(false);
    expect(template.replace(/%s/g, "Audit log")).toBe("ARS CMS");
  });
  it("allowed: nothing changes (the root '%s · ARS CMS' applies)", () => {
    expect(areaTitleMetadata(true)).toEqual({});
  });
  it("both area layouts decide the title from the access checks", () => {
    for (const area of ["admin", "superadmin"]) {
      const layout = fs.readFileSync(path.join(root, "app", area, "layout.tsx"), "utf8");
      expect(layout).toMatch(new RegExp(`export function generateMetadata\\(\\) \\{\\s*return areaMetadata\\("${area}"\\);`));
      expect(layout).toMatch(new RegExp(`requireArea\\("${area}"\\)`));
    }
  });
  it("no admin or superadmin page has metadata the layout template can't cover", () => {
    const pages = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? pages(full) : /^(page|layout)\.tsx$/.test(entry.name) ? [full] : [];
      });
    const bad: string[] = [];
    for (const area of ["admin", "superadmin"]) {
      const files = pages(path.join(root, "app", area));
      expect(files.length).toBeGreaterThan(20);
      for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        const rel = path.relative(root, file);
        if (/title:\s*\{\s*absolute/.test(source)) bad.push(`${rel}: absolute title`);
        if (/generateMetadata/.test(source) && !/app[\\/](admin|superadmin)[\\/]layout\.tsx$/.test(rel)) bad.push(`${rel}: generateMetadata`);
        const exported = source.match(/export const metadata(?::\s*Metadata)?\s*=\s*(\{[^;]*\});/);
        if (exported && !/^\{ title: "[^"]*" \}$/.test(exported[1]!)) bad.push(`${rel}: metadata other than a title`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("NAV-03: '← All …' links keep the list's search and sort", () => {
  it("are OriginLinks, not plain links", () => {
    for (const file of ["app/admin/users/[id]/page.tsx", "app/admin/users/new/page.tsx", "app/superadmin/connections/whatsapp/templates/[code]/page.tsx", "app/superadmin/security/pages/[key]/page.tsx"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source, file).toMatch(/<OriginLink href="[^"]+" className="link text-label" testId="all-link">\s*← All/);
      expect(source, file).not.toMatch(/<Link[^>]*>\s*← All/);
    }
  });
});

describe("NAV-04: the validated ?from= way back on every record's full page", () => {
  it("an admin gets Admin → Records with the list's query", () => {
    expect(returnToFor(admin, "/admin/records/tasks?q=NavAudit&sort=title&open=38")).toEqual({ href: "/admin/records/tasks?q=NavAudit&sort=title&open=38", label: "Admin → Records", area: "admin" });
  });
  it("the wrong role never gets the link (access control unchanged)", () => {
    expect(returnToFor(staff, "/admin/records/tasks?q=1")).toBeNull();
    expect(returnToFor(admin, "/superadmin")).toBeNull();
    expect(returnToFor(person(["USER", "IT_ADMIN"], false), "/admin/records/tasks")).toBeNull();
  });
  it("tampered values are ignored", () => {
    for (const raw of ["//evil.example/admin/records", "https://evil.example/admin/records", "/admin/records/../../users", "/users/tasks", "/admin/users", "/admin/records/tasks#x", "\\admin/records", 5, null]) expect(returnToFor(superAdmin, raw)).toBeNull();
  });
  it("is wired into the task, ticket, meeting, information and request pages", () => {
    for (const file of ["features/work/TaskDetail.tsx", "app/users/tickets/[id]/page.tsx", "app/users/meetings/[id]/page.tsx", "app/users/information/[id]/page.tsx", "app/users/requests/[id]/page.tsx"]) {
      expect(fs.readFileSync(path.join(root, file), "utf8"), file).toMatch(/returnToFor\(user, query\.from\)/);
    }
    expect(fs.readFileSync(path.join(root, "app/users/tasks/[id]/page.tsx"), "utf8")).toMatch(/from\?: string/);
  });
});

describe("NAV-05: the parent crumb names the list the page was opened from", () => {
  const now = 1_000_000_000;
  const raw = (href: string, at = now) => JSON.stringify({ href, at });
  it("another users list (Task Summary → task, Inbox → request) is named and linked", () => {
    expect(originWay("/users/tasks", raw("/users/work/my-tasks?view=list"), now, true)).toEqual({ href: "/users/work/my-tasks?view=list", label: "Task Summary" });
    expect(originWay("/users/queue", raw("/users/inbox?type=approvals"), now, true)).toEqual({ href: "/users/inbox?type=approvals", label: "Inbox" });
  });
  it("the same list keeps its name and gets its query back", () => {
    expect(originWay("/users/queue", raw("/users/queue?sortBy=title"), now, true)).toEqual({ href: "/users/queue?sortBy=title", label: null });
  });
  it("otherwise the page's own parent stays", () => {
    expect(originWay("/users/tasks", raw("/users/work/my-tasks"), now, false)).toEqual({ href: "/users/tasks", label: null });
    expect(originWay("/users/tasks/12", raw("/users/work/my-tasks"), now, true)).toEqual({ href: "/users/tasks/12", label: null });
    expect(originWay("/users/tasks", raw("/admin/records/tasks"), now, true)).toEqual({ href: "/users/tasks", label: null });
    expect(originWay("/users/tasks", raw("//evil.example/users/inbox"), now, true)).toEqual({ href: "/users/tasks", label: null });
    expect(originWay("/users/tasks", raw("/users/inbox", now - ORIGIN_TTL_MS - 1), now, true)).toEqual({ href: "/users/tasks", label: null });
    expect(originWay("/users/tasks", "not json", now, true)).toEqual({ href: "/users/tasks", label: null });
    expect(originWay("/users", raw("/users/inbox"), now, true)).toEqual({ href: "/users", label: null });
  });
});

describe("NAV-06: Back away from a pane with an unsent comment", () => {
  it("knows when a move closes the pane", () => {
    expect(leavesPane("/users/work/my-tasks?task=3", "/users/work/my-tasks")).toBe(true);
    expect(leavesPane("/users/work/my-tasks?task=3", "/users/work/my-tasks?task=4")).toBe(true);
    expect(leavesPane("/admin/records/tasks?open=3&q=a", "/admin/records/tasks?q=a")).toBe(true);
    expect(leavesPane("/users/work/my-tasks?task=3&view=list", "/users/work/my-tasks?task=3")).toBe(false);
    expect(leavesPane(null, "/users")).toBe(true);
  });
  it("PaneControl guards popstate before the router (capture) and restores the address", () => {
    const source = fs.readFileSync(path.join(root, "features/ui/PaneControl.tsx"), "utf8");
    expect(source).toMatch(/addEventListener\("popstate", onPop, true\)/);
    expect(source).toMatch(/stopImmediatePropagation\(\)/);
    expect(source).toMatch(/window\.history\.go\(steps\)/);
  });
});

describe("NAV-08: ← Back never leaves the app", () => {
  it("goes back only after a forward move from a page of this app", () => {
    expect(backStaysInApp({ prev: "/users/inbox", curr: "/users/people/3", pop: false }, "/users/people/3")).toBe(true);
  });
  it("arriving from outside (no previous page), by Back/Forward, or unknown: the in-app link", () => {
    expect(backStaysInApp({ prev: null, curr: "/users/people/3", pop: false }, "/users/people/3")).toBe(false);
    expect(backStaysInApp({ prev: "/users/inbox", curr: "/users/people/3", pop: true }, "/users/people/3")).toBe(false);
    expect(backStaysInApp({ prev: "/users/inbox", curr: "/users/people/4", pop: false }, "/users/people/3")).toBe(false);
    expect(backStaysInApp({ prev: "/users/people/3", curr: "/users/people/3", pop: false }, "/users/people/3")).toBe(false);
  });
  it("with the Navigation API: the entry before decides (after a reload or a typed address too)", () => {
    const trail = { prev: null, curr: "/users/people/3", pop: false };
    expect(backStaysInApp(trail, "/users/people/3", "/users/profile")).toBe(true);
    expect(backStaysInApp(trail, "/users/people/3", null)).toBe(false);
    expect(backStaysInApp(trail, "/users/people/3", "/users/people/3")).toBe(false);
    expect(backStaysInApp(trail, "/users/people/3", "//evil.example/x")).toBe(false);
    expect(backStaysInApp({ prev: "/users/inbox", curr: "/users/people/3", pop: false }, "/users/people/3", null)).toBe(false);
  });
  it("BackLink no longer uses the sticky per-tab flag", () => {
    const source = fs.readFileSync(path.join(root, "features/ui/BackLink.tsx"), "utf8");
    expect(source).not.toMatch(/movedInApp/);
    expect(source).toMatch(/backStaysInApp\(currentTrail\(\), `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`, previousEntry\(\)\)/);
  });
});

describe("CSP: plain http only for a local loopback run (WebKit e2e)", () => {
  const prod = { dev: false, firebaseAuthDomain: "power-bi-dashboard-3b29f.firebaseapp.com" };
  const PRODUCTION =
    "default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; worker-src 'self'; manifest-src 'self'; frame-src https://power-bi-dashboard-3b29f.firebaseapp.com https://accounts.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests";
  it("the production policy is unchanged, byte for byte", () => {
    expect(buildCsp("N", prod)).toBe(PRODUCTION);
    expect(buildCsp("N", { ...prod, localHttp: false })).toBe(PRODUCTION);
    expect(buildCsp("N", { ...prod, localHttp: keepsLocalHttp("approval.arssteels.net", { nodeEnv: "production" }) })).toBe(PRODUCTION);
  });
  it("production never relaxes without the explicit e2e flag, even on localhost", () => {
    expect(keepsLocalHttp("localhost", { nodeEnv: "production" })).toBe(false);
    expect(keepsLocalHttp("localhost:3280", { nodeEnv: "production", e2eLocalHttp: "0" })).toBe(false);
    expect(keepsLocalHttp("127.0.0.1", { nodeEnv: "production", e2eLocalHttp: "true" })).toBe(false);
  });
  it("the real host never relaxes, flag or not; look-alike hosts don't either", () => {
    for (const host of ["approval.arssteels.net", "arssteels.net", "localhost.evil.example", "evil-localhost", "127.0.0.1.nip.io", "10.0.0.1", "", null]) {
      expect(keepsLocalHttp(host, { nodeEnv: "production", e2eLocalHttp: "1" }), String(host)).toBe(false);
      expect(keepsLocalHttp(host, { nodeEnv: "development" }), String(host)).toBe(false);
    }
  });
  it("loopback with the e2e flag, or loopback outside production, keeps http", () => {
    for (const host of ["localhost", "LOCALHOST:3280", "127.0.0.1", "127.0.0.1:3100", "[::1]", "[::1]:3280", "::1"]) {
      expect(keepsLocalHttp(host, { nodeEnv: "production", e2eLocalHttp: "1" }), host).toBe(true);
      expect(keepsLocalHttp(host, { nodeEnv: "development" }), host).toBe(true);
    }
    const relaxed = buildCsp("N", { ...prod, localHttp: true });
    expect(relaxed).toBe(PRODUCTION.replace("; upgrade-insecure-requests", ""));
  });
  it("the middleware decides it per request from the host", () => {
    const middleware = fs.readFileSync(path.join(root, "middleware.ts"), "utf8");
    expect(middleware).toMatch(/localHttp: keepsLocalHttp\(request\.headers\.get\("x-forwarded-host"\) \?\? request\.headers\.get\("host"\), \{ nodeEnv: process\.env\.NODE_ENV, e2eLocalHttp: process\.env\.E2E_LOCAL_HTTP \}\)/);
  });
});
