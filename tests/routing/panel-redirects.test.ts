import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PANEL_REDIRECTS, panelRedirect, panelRedirectUrl } from "@/lib/routing/panel-redirects";

// v1.84.0 / v1.85.0 (D-411, D-412): every Admin and Super Admin page address
// from before the redesign still works: it redirects to a page that exists.
const ROOT = path.resolve(__dirname, "../..");

// Every page address the two panels had at v1.83.0 that moved (dynamic parts
// filled with a sample). Pages that kept their address are listed in STAYED.
export const OLD_SUPERADMIN = [
  "/superadmin/settings",
  "/superadmin/integrations",
  "/superadmin/integrations/google-calendar",
  "/superadmin/ai",
  "/superadmin/ai/data-sources",
  "/superadmin/ai/reports",
  "/superadmin/ai/history",
  "/superadmin/salesforce",
  "/superadmin/pages",
  "/superadmin/pages/users.queue",
  "/superadmin/templates",
  "/superadmin/templates/REQUEST_SUBMITTED",
  "/superadmin/requests",
  "/superadmin/import",
  "/superadmin/demo",
  "/superadmin/automation",
  "/superadmin/retention",
  "/superadmin/backup",
  "/superadmin/deliveries",
  "/superadmin/audit",
  "/superadmin/logins",
];
export const OLD_ADMIN_MOVED = ["/admin/import"];
const STAYED = ["/superadmin", "/admin", "/admin/users", "/admin/users/new", "/admin/users/7", "/admin/organisation", "/admin/calendar", "/admin/records/requests", "/admin/records/tasks", "/admin/records/information"];

// Does an address have a page.tsx (route groups and [dynamic] folders allowed)?
function pageExists(address: string): boolean {
  const parts = address.split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const groups = entries.filter((entry) => /^\(.*\)$/.test(entry.name));
    if (rest.length === 0) return fs.existsSync(path.join(dir, "page.tsx")) || groups.some((group) => walk(path.join(dir, group.name), rest));
    const [head, ...tail] = rest;
    const exact = entries.find((entry) => entry.name === head);
    if (exact && walk(path.join(dir, exact.name), tail)) return true;
    const dynamic = entries.find((entry) => /^\[[^.\]]+\]$/.test(entry.name));
    if (dynamic && walk(path.join(dir, dynamic.name), tail)) return true;
    return groups.some((group) => walk(path.join(dir, group.name), rest));
  };
  return walk(path.join(ROOT, "app"), parts);
}

describe("panel redirect map", () => {
  it.each([...OLD_SUPERADMIN, ...OLD_ADMIN_MOVED])("%s redirects to a page that exists", (old) => {
    const target = panelRedirect(old);
    expect(target, `${old} has no redirect`).not.toBeNull();
    const clean = target!.split(/[?#]/)[0]!;
    expect(pageExists(clean), `${old} → ${clean}: no page there`).toBe(true);
    expect(pageExists(old), `${old} still has its own page (it would never be reached)`).toBe(false);
  });

  it.each(STAYED)("%s kept its address", (address) => {
    expect(panelRedirect(address)).toBeNull();
    expect(pageExists(address)).toBe(true);
  });

  it("every target in the map exists and no target is itself redirected", () => {
    for (const entry of PANEL_REDIRECTS) {
      const clean = entry.to.split(/[?#]/)[0]!;
      expect(pageExists(clean), `${entry.from} → ${clean}`).toBe(true);
      expect(panelRedirect(clean), `${clean} would redirect again`).toBeNull();
    }
  });

  it("keeps the query and puts a fragment last; leaves API routes alone", () => {
    expect(panelRedirectUrl("/superadmin/templates/X", "?a=1")).toBe("/superadmin/connections/whatsapp/templates/X?a=1");
    expect(panelRedirectUrl("/superadmin/requests/", "")).toBe("/superadmin/data/danger-zone/requests");
    expect(panelRedirect("/api/superadmin/audit")).toBeNull();
    expect(panelRedirect("/superadmin/connections/email")).toBeNull();
  });
});
