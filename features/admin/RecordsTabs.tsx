import Link from "next/link";
import { featureOn, type Feature } from "@/server/settings/features";
import type { AuthenticatedUser } from "@/types/auth";

// v1.85.0 (D-412): the five Records tabs (approval requests, tasks,
// information, tickets, meetings). A switched-off module's tab is left out,
// as in the sidebar (D-395); its page refuses anyway.
export type RecordsTab = "requests" | "tasks" | "information" | "tickets" | "meetings";
export const RECORDS_TABS: { key: RecordsTab; label: string; href: string; feature: Feature | null }[] = [
  { key: "requests", label: "Approval requests", href: "/admin/records/requests", feature: null },
  { key: "tasks", label: "Tasks", href: "/admin/records/tasks", feature: "tasks" },
  { key: "information", label: "Information", href: "/admin/records/information", feature: "information" },
  { key: "tickets", label: "Tickets", href: "/admin/records/tickets", feature: null },
  { key: "meetings", label: "Meetings", href: "/admin/records/meetings", feature: null },
];

export async function recordsTabsOn(user: AuthenticatedUser): Promise<RecordsTab[]> {
  const on = await Promise.all(RECORDS_TABS.map((tab) => (tab.feature ? featureOn(tab.feature, user).catch(() => false) : Promise.resolve(true))));
  return RECORDS_TABS.filter((_, index) => on[index]).map((tab) => tab.key);
}

export async function RecordsTabs({ current, user }: { current: RecordsTab; user: AuthenticatedUser }) {
  const on = await recordsTabsOn(user);
  return (
    <nav aria-label="Records" className="mb-4 flex flex-wrap gap-2" data-testid="records-tabs">
      {RECORDS_TABS.filter((tab) => on.includes(tab.key) || tab.key === current).map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-label ${tab.key === current ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted hover:bg-surface-muted"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
