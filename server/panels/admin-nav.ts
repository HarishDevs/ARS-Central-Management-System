import "server-only";
import type { NavItem } from "@/features/shell/SideNav";
import { featureOn } from "@/server/settings/features";
import type { AuthenticatedUser } from "@/types/auth";

// The Admin panel's sidebar (D-039 IT team area). v1.84.0 (D-411): one list
// for the sidebar and Search settings. v1.85.0 (D-412, owner's redesign):
// five groups (Overview, Records, Insights, Set-up, People & organisation);
// Insights and Set-up are hubs with their own tabs and section list.
export async function adminNav(user: AuthenticatedUser): Promise<NavItem[]> {
  // v1.72.1 (D-395, QA F-14): records of a switched-off module leave the menu (set-up pages stay, so IT can prepare).
  const [tasks, information] = await Promise.all([featureOn("tasks", user), featureOn("information", user)]);
  return [
    { href: "/admin", label: "Overview", section: "Overview" },
    // D-191 (owner): every record, whoever raised it. v1.85.0: tickets and meetings too.
    { href: "/admin/records/requests", label: "Approval requests", section: "Records" },
    ...(tasks ? [{ href: "/admin/records/tasks", label: "Tasks", section: "Records" }] : []),
    ...(information ? [{ href: "/admin/records/information", label: "Information", section: "Records" }] : []),
    { href: "/admin/records/tickets", label: "Tickets", section: "Records" },
    { href: "/admin/records/meetings", label: "Meetings", section: "Records" },
    { href: "/admin/insights", label: "Insights", section: "Insights" },
    { href: "/admin/setup", label: "Set-up", section: "Set-up" },
    { href: "/admin/users", label: "Users & roles", section: "People & organisation" },
    { href: "/admin/organisation", label: "Departments", section: "People & organisation" },
    { href: "/admin/calendar", label: "Working calendar", section: "People & organisation" },
  ];
}
