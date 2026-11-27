import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { BackLink } from "@/features/ui/BackLink";
import { NoResults, Pagination } from "@/features/ui/Display";
import { SafeText } from "@/features/ui/SafeText";
import { ControlActionForm, PurgeForm } from "@/features/superadmin/ControlForms";
import { BIN_DAYS, daysUntilPurge, listBin, type BinEntityType } from "@/lib/db/repositories/superadmin-bin.repository";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { CONTROL_MODULES, confirmWordFor, MODULE_LABEL } from "@/server/superadmin/control/service";

export const metadata: Metadata = { title: "Deleted items" };
export const dynamic = "force-dynamic";

// v1.94.0 (D-454, D-455, owner: "Bin, then purge"): everything Super Admin
// moved to the bin, from every module. Hidden from everyone else; restorable
// here (with a reason); Delete permanently only after 30 days, with the item's
// number typed to confirm. The audit log keeps the record either way.
export default async function DeletedItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireArea("superadmin");
  const query = await searchParams;
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]![0] : query[key]) ?? "";
  const q = one("q").slice(0, 100);
  const kind = (CONTROL_MODULES as readonly string[]).includes(one("module")) ? (one("module") as BinEntityType) : null;
  const result = await listBin({
    module: kind,
    q,
    page: Number(one("page")) || 1,
  });
  const hrefFor = (page: number) => `/superadmin/control/bin?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { module: kind } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;
  return (
    <>
      <BackLink fallback="/superadmin/control" label="Control panel" />
      <PageHeader
        title="Deleted items"
        description={`Items moved to the bin from the control panel (and requests deleted in the Danger zone). Nobody else sees them anywhere. Restore one with a reason, or after ${BIN_DAYS} days delete it permanently; the audit log keeps the record that it existed.`}
      />
      <form method="get" action="/superadmin/control/bin" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="bin-q" className="field-label">
            Number, title or reason
          </label>
          <input id="bin-q" name="q" defaultValue={q} maxLength={100} className="field-input" data-testid="bin-search" />
        </div>
        <div>
          <label htmlFor="bin-module" className="field-label">
            Module
          </label>
          <select id="bin-module" name="module" defaultValue={kind ?? ""} className="field-input">
            <option value="">All modules</option>
            {CONTROL_MODULES.map((value) => (
              <option key={value} value={value}>
                {MODULE_LABEL[value]}s
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary btn-compact">
          Filter
        </button>
      </form>
      <p className="mb-2 text-caption text-ink-muted" role="status">
        {result.total === 0
          ? "The bin is empty."
          : `${result.total.toLocaleString("en-IN")} item${result.total === 1 ? "" : "s"} in the bin${result.pages > 1 ? ` · page ${result.page} of ${result.pages}` : ""}`}
      </p>
      {result.items.length === 0 && (q || kind) && <NoResults what="deleted items" query={q} clearSearchHref="/superadmin/control/bin" />}
      {result.items.length > 0 && (
        <section className="card table-cards overflow-x-auto">
          <table className="data-table max-md:p-3" data-testid="bin-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Module</th>
                <th>Moved to the bin</th>
                <th>Reason</th>
                <th className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((entry) => {
                const days = daysUntilPurge(entry);
                const label = entry.entityNo ?? entry.title;
                return (
                  <tr key={entry.id}>
                    <td data-card-title="">
                      <Link href={`/superadmin/control/${entry.entityType.toLowerCase()}/${entry.entityId}`} className="link font-mono text-label">
                        {label}
                      </Link>
                      <p className="max-w-xs truncate text-caption text-ink-muted">
                        <SafeText text={entry.title} />
                      </p>
                      {entry.childCount > 0 && (
                        <p className="text-caption text-ink-muted">
                          With {entry.childCount} linked item
                          {entry.childCount === 1 ? "" : "s"} (subtasks or work steps)
                        </p>
                      )}
                    </td>
                    <td data-label="Module">{MODULE_LABEL[entry.entityType]}</td>
                    <td data-label="Moved to the bin" className="whitespace-nowrap text-label">
                      {formatIndiaTime(entry.binnedAt)}
                      <p className="text-caption text-ink-muted">by {entry.binnedByName ?? "—"}</p>
                      <p className="text-caption text-ink-muted">{days > 0 ? `${days} day${days === 1 ? "" : "s"} until it can be deleted permanently` : "Can be deleted permanently"}</p>
                    </td>
                    <td data-label="Reason" className="text-label">
                      <SafeText text={entry.reason} />
                    </td>
                    <td className="space-y-2 text-right">
                      <ControlActionForm
                        kind="restore"
                        hidden={{ entryId: entry.id }}
                        label="Restore"
                        title={`Restore ${label}?`}
                        note="It comes back where it was, for everyone who could see it. A request that was open when it was binned comes back cancelled: reopen it from the control panel if it should run again."
                        submitLabel="Restore"
                        testId={`restore-${entry.id}`}
                      />
                      <PurgeForm entryId={entry.id} word={confirmWordFor(entry)} daysLeft={days} label={label} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {result.pages > 1 && (
        <div className="mt-4">
          <Pagination page={result.page} pages={result.pages} hrefFor={hrefFor} />
        </div>
      )}
    </>
  );
}
