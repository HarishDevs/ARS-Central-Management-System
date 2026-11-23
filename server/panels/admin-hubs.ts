import "server-only";
import { isHiddenHref, navAccess } from "@/server/authorization/page-access";
import { canUseReports, featureOn } from "@/server/settings/features";
import type { SettingsSection } from "@/features/ui/SettingsLayout";
import type { AuthenticatedUser } from "@/types/auth";

// v1.85.0 (D-412, owner's Admin redesign): the Insights hub's tabs and the
// Set-up hub's sections for this person. Each keeps its feature switch and
// page-access key (a hidden page leaves the list; its address still refuses
// on the server).
export async function insightsTabs(user: AuthenticatedUser): Promise<{ href: string; label: string }[]> {
  const [analytics, reports, ai, { hidden }] = await Promise.all([featureOn("analytics", user), canUseReports(user), featureOn("ai", user), navAccess(user)]);
  return [
    { href: "/admin/insights", label: "Summary", on: true },
    { href: "/admin/insights/dashboards", label: "Dashboards", on: true },
    { href: "/admin/insights/analytics", label: "Analytics", on: analytics },
    { href: "/admin/insights/reports", label: "Reports", on: reports },
    { href: "/admin/insights/workload", label: "Workload", on: true },
    { href: "/admin/insights/ai", label: "AI analytics", on: ai },
  ]
    .filter((tab) => tab.on && !isHiddenHref(tab.href, hidden))
    .map(({ href, label }) => ({ href, label }));
}

export const SETUP_SECTIONS: (SettingsSection & { keywords?: string })[] = [
  { href: "/admin/setup/custom-approval", label: "Custom approval", group: "Approvals", description: "The fields and step options of custom approvals." },
  { href: "/admin/setup/groups", label: "Approver groups", group: "Approvals", description: "Desks such as MD office or Finance checkers, so approvers can change without editing workflows." },
  { href: "/admin/setup/doa", label: "Approval authority (DoA)", group: "Approvals", description: "Which levels each amount needs, read from every live approval type's DoA matrix." },
  { href: "/admin/setup/budgets", label: "Budgets", group: "Approvals", description: "Department budgets and what over-budget requests do." },
  { href: "/admin/setup/task-types", label: "Task types", group: "Tasks", description: "The kinds of task: form, who may create and be assigned, steps, evidence and reminders." },
  { href: "/admin/setup/task-settings", label: "Task settings and holidays", group: "Tasks", description: "Task holidays, tasks due on a holiday, the morning summary and repeating tasks." },
  { href: "/admin/setup/information-types", label: "Information types", group: "Information", description: "The kinds of information: form, recipients, acknowledgement, expiry and reminders." },
  { href: "/admin/setup/ticket-forms", label: "Ticket forms", group: "Ticketing", description: "Ticket forms: fields, category, coordinators and who may raise them." },
  { href: "/admin/setup/ticket-categories", label: "Ticket categories", group: "Ticketing", description: "Categories, number prefixes, and who else sees tickets." },
  { href: "/admin/setup/meetings", label: "Meeting settings", group: "Meetings", description: "Meeting types with their default points, and the Management group." },
  { href: "/admin/setup/reminders", label: "Reminders & escalations", group: "Automation", description: "Rules that remind people and escalate late approvals and tasks." },
  { href: "/admin/setup/notifications", label: "Notifications", group: "Automation", description: "Broadcast notices to everyone or chosen people." },
  { href: "/admin/setup/ai-rules", label: "AI rules", group: "AI", description: "The rules every AI provider follows (company terms, where data is kept)." },
];

export async function setupSections(user: AuthenticatedUser): Promise<SettingsSection[]> {
  const { hidden } = await navAccess(user);
  return SETUP_SECTIONS.filter((section) => !isHiddenHref(section.href, hidden));
}
