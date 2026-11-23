import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { navAccess } from "@/server/authorization/page-access";
import { adminHomeCounts as counts } from "@/lib/db/repositories/insights.repository";
import { listModuleTypes } from "@/lib/db/repositories/module-types.repository";
import { findStuckRequests } from "@/server/ops/stuck";
import { getNumberSetting } from "@/server/settings/values";
import { applyDefaultListView } from "@/server/lists/views";
import { AttentionSection } from "@/features/admin/AttentionSection";
import { RecordSearchResults } from "@/features/admin/RecordSearchResults";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Admin overview" };
export const dynamic = "force-dynamic";

const n = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN");

// v1.85.0 (D-412, owner's Admin redesign): the Admin overview. Today's
// figures (each a link), one search across every kind of record, and Needs
// attention built in (/admin/attention redirects to #attention). Each part
// keeps its own page-access key: a person for whom Needs attention or Records
// is hidden doesn't get that part.
export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Pages re-check the space themselves: a layout check alone does not stop
  // a page from rendering in the App Router.
  const { user } = await requireArea("admin");
  const query = await searchParams;
  const { hidden } = await navAccess(user);
  const attentionOn = !hidden.has("admin.attention");
  const recordsOn = !hidden.has("admin.records");
  const q = recordsOn ? (query.q ?? "").trim().slice(0, 100) : "";
  if (attentionOn && !q) await applyDefaultListView(user.id, "list_admin_attention", "/admin", query);
  const idleDays = (await getNumberSetting("general.stuck_idle_days").catch(() => 7)) || 7;
  const [c, taskTypes, infoTypes, stuck] = await Promise.all([counts(), listModuleTypes("TASK"), listModuleTypes("INFO"), attentionOn ? findStuckRequests({ idleDays }).catch(() => []) : Promise.resolve([])]);
  const live = (types: { active: boolean; liveVersion: number | null }[]) => types.filter((type) => type.active && type.liveVersion !== null).length;
  const figures = [
    { label: "Open requests", value: n(c.open_requests), href: "/admin/records/requests?status=IN_PROGRESS", show: recordsOn },
    { label: "Need attention", value: n(stuck.length), href: "#attention", show: attentionOn, warn: stuck.length > 0 },
    { label: "Live approval types", value: n(c.live_types), href: "/admin/setup/doa", show: true },
    { label: "Live task types", value: n(live(taskTypes)), href: "/admin/setup/task-types", show: true },
    { label: "Live information types", value: n(live(infoTypes)), href: "/admin/setup/information-types", show: true },
    { label: "Active people", value: n(c.users), href: "/admin/users", show: true },
    { label: "Approver groups", value: n(c.groups_n), href: "/admin/setup/groups", show: true },
    { label: "Upcoming holidays", value: n(c.holidays), href: "/admin/calendar", show: true },
  ].filter((figure) => figure.show);

  return (
    <>
      <PageHeader title="Admin" description="Today's figures, a search across every record, and what needs attention. Set-up, Insights and People are in the sidebar." />
      <section aria-labelledby="figures-title" data-testid="admin-figures">
        <h2 id="figures-title" className="sr-only">
          Today&apos;s figures
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map((figure) => (
            <li key={figure.label}>
              <Link href={figure.href} className="card-link flex h-full flex-col p-4">
                <span className="text-caption text-ink-muted">{figure.label}</span>
                <span className={`mt-1 text-title font-semibold tabular-nums ${figure.warn ? "text-warning-600" : ""}`}>{figure.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {recordsOn && (
        <section aria-labelledby="record-search-title" className="mt-8" data-testid="record-search">
          <h2 id="record-search-title" className="mb-3 text-subhead font-semibold">
            Search records
          </h2>
          <form method="get" action="/admin" role="search" className="flex max-w-xl gap-2">
            <label htmlFor="admin-record-search" className="sr-only">
              Number, title or person, across requests, tasks, information, tickets and meetings
            </label>
            <div className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input id="admin-record-search" type="search" name="q" defaultValue={q} maxLength={100} placeholder="Number, title or person" className="field-input pl-9" />
            </div>
            <button type="submit" className="btn-primary">
              Search
            </button>
          </form>
          {q && <RecordSearchResults user={user} q={q} />}
        </section>
      )}

      {attentionOn && <AttentionSection userId={user.id} query={query} />}
    </>
  );
}
