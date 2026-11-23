// v1.84.0 / v1.85.0 (D-411, D-412; owner, 23 Nov 2026: the Admin and Super
// Admin redesign, docs/ops/ADMIN-REDESIGN-BRIEF.md): every address the two
// panels had before the redesign, and where it lives now. The middleware
// sends an old address on permanently (308) with its query kept, so
// bookmarks, emails, help links and tests keep working. Pure and edge-safe;
// tests/routing/panel-redirects.test.ts checks that every old page address
// resolves to a page that exists.
//
// `prefix: true` also moves everything under the old address (/superadmin/
// templates/<code> → /superadmin/connections/whatsapp/templates/<code>).
export interface PanelRedirect {
  from: string;
  to: string;
  prefix?: boolean;
}

export const PANEL_REDIRECTS: readonly PanelRedirect[] = [
  // ---- Super Admin (v1.84.0, D-411) ----
  { from: "/superadmin/settings", to: "/superadmin/connections/email" },
  { from: "/superadmin/integrations/google-calendar", to: "/superadmin/connections/google" },
  { from: "/superadmin/integrations", to: "/superadmin/connections/google" },
  { from: "/superadmin/ai/data-sources", to: "/superadmin/connections/ai/data-sources", prefix: true },
  { from: "/superadmin/ai/reports", to: "/superadmin/monitoring/ai-reports", prefix: true },
  { from: "/superadmin/ai/history", to: "/superadmin/monitoring/ai-history", prefix: true },
  { from: "/superadmin/ai", to: "/superadmin/connections/ai" },
  { from: "/superadmin/salesforce", to: "/superadmin/connections/salesforce" },
  { from: "/superadmin/pages", to: "/superadmin/security/pages", prefix: true },
  { from: "/superadmin/templates", to: "/superadmin/connections/whatsapp/templates", prefix: true },
  { from: "/superadmin/requests", to: "/superadmin/data/danger-zone/requests" },
  { from: "/superadmin/demo", to: "/superadmin/data/danger-zone/demo" },
  { from: "/superadmin/import", to: "/superadmin/data/import" },
  { from: "/superadmin/automation", to: "/superadmin/monitoring/jobs" },
  { from: "/superadmin/retention", to: "/superadmin/data/retention" },
  { from: "/superadmin/backup", to: "/superadmin/data/backup" },
  { from: "/superadmin/deliveries", to: "/superadmin/monitoring/deliveries" },
  { from: "/superadmin/audit", to: "/superadmin/monitoring/audit" },
  { from: "/superadmin/logins", to: "/superadmin/security/sign-in-history" },
  // Owner (23 Nov 2026): Import data is the Super Admin's alone now (one page, both kinds).
  { from: "/admin/import", to: "/superadmin/data/import" },
];

// The new address for an old one (with whatever followed a prefix), else null.
// Only page addresses: API routes and the new addresses never match.
export function panelRedirect(pathname: string): string | null {
  if (!/^\/(admin|superadmin)\//.test(pathname)) return null;
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  for (const entry of PANEL_REDIRECTS) {
    if (clean === entry.from) return entry.to;
    if (entry.prefix && clean.startsWith(`${entry.from}/`)) return `${entry.to}${clean.slice(entry.from.length)}`;
  }
  return null;
}

// The full target with the old query kept; a fragment in the target ("#attention") goes last.
export function panelRedirectUrl(pathname: string, search: string): string | null {
  const to = panelRedirect(pathname);
  if (!to) return null;
  const [path, hash] = to.split("#");
  return `${path}${search}${hash ? `#${hash}` : ""}`;
}
