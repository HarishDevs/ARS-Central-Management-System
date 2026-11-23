import "server-only";
import type { NavItem } from "@/features/shell/SideNav";
import type { SettingsIndexEntry } from "@/features/ui/SettingsSearch";
import { splitLabel } from "@/features/superadmin/split-label";
import { evaluateAreaAccess } from "@/server/authorization/policy";
import { isHiddenHref, navAccess } from "@/server/authorization/page-access";
import { SETTING_DEFINITIONS } from "@/server/settings/definitions";
import { SETTING_GROUP_PAGE, SUPERADMIN_NAV, SUPERADMIN_SUBPAGES } from "@/server/panels/superadmin-nav";
import { adminNav } from "@/server/panels/admin-nav";
import { insightsTabs, SETUP_SECTIONS } from "@/server/panels/admin-hubs";
import type { AuthenticatedUser } from "@/types/auth";

// v1.84.0 (D-411, owner's redesign): what Search settings may find for this
// person, across both panels. Built on the server from the same lists the
// sidebars use, so a person only finds what they may open:
// - Super Admin pages and every Super Admin setting only for the Super Admin;
// - Admin pages only with the Admin area, less any page hidden for them
//   (page access) and anything switched off (the sidebar's own checks).
// Setting values are never part of the index (only names and keys).
export function superAdminEntries(): SettingsIndexEntry[] {
  const place = (item: NavItem) => `Super Admin → ${item.section ?? "Health"}`;
  const pages = SUPERADMIN_NAV.map((item) => ({ label: item.label, href: item.href, place: place(item) }));
  const subpages = SUPERADMIN_SUBPAGES.map((item) => {
    const parent = SUPERADMIN_NAV.find((entry) => entry.href === item.parent);
    return { label: item.label, href: item.href, place: parent ? `${place(parent)} → ${parent.label}` : "Super Admin" };
  });
  const settings = SETTING_DEFINITIONS.map((definition) => {
    const href = SETTING_GROUP_PAGE[definition.group];
    const page = SUPERADMIN_NAV.find((item) => item.href === href.split("#")[0]);
    const { name, hint } = splitLabel(definition.label);
    return { label: name, href, place: page ? `${place(page)} → ${page.label}` : "Super Admin", keywords: `${definition.key} ${hint ?? ""}` };
  });
  return [...pages, ...subpages, ...settings];
}

export function adminEntries(items: readonly NavItem[], hidden: Set<string>, extra: readonly SettingsIndexEntry[] = []): SettingsIndexEntry[] {
  const visible = (href: string) => !isHiddenHref(href, hidden);
  return [
    ...items.filter((item) => visible(item.href)).map((item) => ({ label: item.label, href: item.href, place: `Admin${item.section ? ` → ${item.section}` : ""}` })),
    ...extra.filter((entry) => visible(entry.href)),
  ];
}

export async function settingsIndexFor(user: AuthenticatedUser, admin?: { items: readonly NavItem[]; extra?: readonly SettingsIndexEntry[] }): Promise<SettingsIndexEntry[]> {
  const out: SettingsIndexEntry[] = [];
  if (evaluateAreaAccess(user, "superadmin").allowed) out.push(...superAdminEntries());
  if (evaluateAreaAccess(user, "admin").allowed) {
    const items = admin?.items ?? (await adminNav(user));
    const { hidden } = await navAccess(user);
    // v1.85.0 (D-412): also each Insights tab (only those switched on) and Set-up section.
    const extra: SettingsIndexEntry[] = [
      { label: "Needs attention", href: "/admin/attention", place: "Admin → Overview", keywords: "stuck requests blocked inactive approver unsent" },
      ...(await insightsTabs(user)).filter((tab) => tab.href !== "/admin/insights").map((tab) => ({ label: tab.label, href: tab.href, place: "Admin → Insights" })),
      ...SETUP_SECTIONS.map((section) => ({ label: section.label, href: section.href, place: `Admin → Set-up → ${section.group}`, keywords: section.description })),
      ...(admin?.extra ?? []),
    ];
    out.push(...adminEntries(items, hidden, extra));
  }
  return out;
}
