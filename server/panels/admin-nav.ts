import "server-only";
import type { NavItem } from "@/features/shell/SideNav";
import { canUseReports, featureOn } from "@/server/settings/features";
import type { AuthenticatedUser } from "@/types/auth";

// The Admin panel's sidebar (D-039 IT team area). v1.84.0 (D-411): moved
// here from the layout so Search settings can use the same list.
export async function adminNav(user: AuthenticatedUser): Promise<NavItem[]> {
  const analytics = await featureOn("analytics", user);
  const reports = await canUseReports(user);
  // v1.72.1 (D-395, QA F-14): records of a switched-off module leave the menu (set-up pages stay, so IT can prepare).
  const [tasks, information, ai] = await Promise.all([featureOn("tasks", user), featureOn("information", user), featureOn("ai", user)]);
  return [
    { href: "/admin", label: "Overview" },
    { href: "/admin/attention", label: "Needs attention" },
    ...(analytics ? [{ href: "/admin/analytics", label: "Analytics" }] : []),
    ...(reports ? [{ href: "/admin/reports", label: "Reports" }] : []),
    { href: "/admin/insights", label: "Insights" },
    { href: "/admin/dashboards", label: "Dashboards" },
    { href: "/admin/workload", label: "Workload" },
    // D-191 (owner): every record, whoever raised it.
    { href: "/admin/records/requests", label: "Approval requests", section: "Records" },
    ...(tasks ? [{ href: "/admin/records/tasks", label: "Tasks", section: "Records" }] : []),
    ...(information ? [{ href: "/admin/records/information", label: "Information", section: "Records" }] : []),
    { href: "/admin/custom-approval", label: "Custom approval", section: "Approval set-up" },
    { href: "/admin/groups", label: "Approver groups", section: "Approval set-up" },
    { href: "/admin/doa", label: "Approval authority (DoA)", section: "Approval set-up" },
    { href: "/admin/budgets", label: "Budgets", section: "Approval set-up" },
    { href: "/admin/task-types", label: "Task types", section: "Task set-up" },
    { href: "/admin/task-holidays", label: "Task settings", section: "Task set-up" },
    { href: "/admin/information-types", label: "Information types", section: "Information set-up" },
    { href: "/admin/ticket-forms", label: "Ticket forms", section: "Ticketing set-up" },
    { href: "/admin/ticket-categories", label: "Ticket categories", section: "Ticketing set-up" },
    { href: "/admin/meetings", label: "Meeting settings", section: "Meeting set-up" },
    { href: "/admin/reminders", label: "Reminders & escalations", section: "Automation" },
    { href: "/admin/notifications", label: "Notifications", section: "Automation" },
    ...(ai ? [{ href: "/admin/ai-analytics", label: "AI analytics", section: "AI" }] : []),
    { href: "/admin/ai-rules", label: "AI rules", section: "AI" },
    { href: "/admin/calendar", label: "Working calendar", section: "Organisation" },
    { href: "/admin/users", label: "Users & roles", section: "Organisation" },
    { href: "/admin/organisation", label: "Departments", section: "Organisation" },
  ];
}
