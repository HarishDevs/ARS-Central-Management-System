import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge, NoResults } from "@/features/ui/Display";
import { SafeText } from "@/features/ui/SafeText";
import { CreateOnBehalf } from "@/features/superadmin/CreateOnBehalf";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { personLabel } from "@/lib/people/label";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { CONTROL_MODULES, MODULE_LABEL, SEARCH_LIMIT, searchControl, type ControlModule, type ControlState } from "@/server/superadmin/control/service";

export const metadata: Metadata = { title: "Control panel" };
export const dynamic = "force-dynamic";

const STATES: [ControlState, string][] = [
  ["ANY", "Any state"],
  ["OPEN", "Open"],
  ["FINISHED", "Finished"],
  ["ARCHIVED", "Archived"],
];

// v1.94.0 (D-451, owner 27 Nov 2026: "From Super admin should be able to
// create, Modify, Delete, archive anything like approval, task, Ticket at any
// level"): find any item across the modules, open it to modify, archive or
// move it to the bin; or create one on someone's behalf. Super Admin only.
export default async function ControlPanelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]![0] : query[key]) ?? "";
  const q = one("q").slice(0, 100);
  const kind = (CONTROL_MODULES as readonly string[]).includes(one("module")) ? (one("module") as ControlModule) : null;
  const state = (STATES.map(([value]) => value) as string[]).includes(one("state")) ? (one("state") as ControlState) : "ANY";
  const searched = Boolean(q || kind || state !== "ANY");
  const items = searched ? await searchControl({ q, module: kind, state }, user) : [];
  const people = (await listActiveUserOptions())
    .filter((person) => person.id !== user.id)
    .map((person) => ({
      id: person.id,
      label: personLabel(person),
      detail: person.departmentName ?? undefined,
    }));
  return (
    <>
      <PageHeader
        title="Control panel"
        description="Find any approval, task or ticket and open it to change it (each change needs a reason and shows as changed by Super Admin), archive it, or move it to Deleted items. Or create one on someone's behalf."
      />
      <div className="space-y-6">
        <section className="card px-5 py-4" aria-labelledby="find-heading">
          <h2 id="find-heading" className="mb-3 font-semibold">
            Find an item
          </h2>
          <form method="get" action="/superadmin/control" className="flex flex-wrap items-end gap-3" role="search">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="control-q" className="field-label">
                Number, title or person
              </label>
              <input id="control-q" name="q" defaultValue={q} maxLength={100} className="field-input" placeholder="e.g. CUS-2026-000123, laptop, Priya" data-testid="control-search" />
            </div>
            <div>
              <label htmlFor="control-module" className="field-label">
                Module
              </label>
              <select id="control-module" name="module" defaultValue={kind ?? ""} className="field-input">
                <option value="">All modules</option>
                {CONTROL_MODULES.map((value) => (
                  <option key={value} value={value}>
                    {MODULE_LABEL[value]}s
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="control-state" className="field-label">
                State
              </label>
              <select id="control-state" name="state" defaultValue={state} className="field-input">
                {STATES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary btn-compact">
              Search
            </button>
          </form>
          <p className="mt-3 text-caption text-ink-muted">
            Items in the bin are listed under{" "}
            <Link href="/superadmin/control/bin" className="link">
              Deleted items
            </Link>
            . Projects, portfolios, meetings and forms join this panel in a later release.
          </p>
        </section>

        {searched && (
          <section className="card table-cards overflow-x-auto" aria-label="Matching items">
            <p className="px-5 pt-4 text-caption text-ink-muted" role="status">
              {items.length === 0
                ? "No items match."
                : `${items.length}${items.length === SEARCH_LIMIT ? "+" : ""} item${items.length === 1 ? "" : "s"} (newest first${items.length === SEARCH_LIMIT ? `; the first ${SEARCH_LIMIT} shown, narrow the search` : ""})`}
            </p>
            {items.length === 0 ? (
              <div className="px-5 pb-4">
                <NoResults what="items" query={q} clearSearchHref="/superadmin/control" />
              </div>
            ) : (
              <table className="data-table max-md:p-3" data-testid="control-results">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Module</th>
                    <th>Raised / created by</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`${item.module}-${item.id}`}>
                      <td data-card-title="">
                        <Link href={`/superadmin/control/${item.module.toLowerCase()}/${item.id}`} className="link font-mono text-label">
                          {item.number}
                        </Link>
                        <p className="max-w-xs truncate text-caption text-ink-muted">
                          <SafeText text={item.title} />
                        </p>
                      </td>
                      <td data-label="Module">{MODULE_LABEL[item.module]}</td>
                      <td data-label="Raised / created by">
                        {item.ownerName}
                        {item.assigneeName && <p className="text-caption text-ink-muted">Assigned to {item.assigneeName}</p>}
                        {item.onBehalfByName && <p className="text-caption text-ink-muted">Created by Super Admin on their behalf</p>}
                      </td>
                      <td data-label="Status">
                        <span className="text-label">{item.statusLabel}</span>
                        {item.archivedAt && (
                          <Badge tone="neutral" className="ml-2">
                            Archived
                          </Badge>
                        )}
                      </td>
                      <td data-label="Date" className="whitespace-nowrap text-label text-ink-muted">
                        {formatIndiaTime(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <section className="card px-5 py-4" aria-labelledby="behalf-heading">
          <h2 id="behalf-heading" className="mb-3 font-semibold">
            Create on someone&apos;s behalf
          </h2>
          <CreateOnBehalf people={people} />
        </section>
      </div>
    </>
  );
}
