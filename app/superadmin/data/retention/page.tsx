import type { Metadata } from "next";
import { PagedRows } from "@/features/ui/PagedRows";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge } from "@/features/ui/Display";
import { Hint } from "@/features/ui/Hint";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";
import { CreateHoldForm, ReleaseHoldForm } from "@/features/superadmin/HoldForms";
import { listHolds, retentionDryRun } from "@/server/ops/governance";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { ListViews } from "@/features/lists/ListViews";
import { sortHeads } from "@/features/superadmin/sort-heads";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "sorting in all the tables ... in all columns"): both
// tables sort by any column (one sort on the page at a time); views save it.
// No Group by: holds and retention rules are short settings lists.
const HOLD_COLUMNS = ["hold_ref", "hold_covers", "hold_owner", "hold_placed", "hold_status"] as const;
const RETENTION_COLUMNS = ["ret_records", "ret_kept", "ret_past", "ret_held", "ret_oldest"] as const;
const PATH = "/superadmin/data/retention";
const TARGET = "list_super_retention";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Retention & legal holds" };

export const dynamic = "force-dynamic";

// FN10 retention and legal holds (Super Admin). Holds are enforced; the
// retention section is a dry run only.
export default async function RetentionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("superadmin");
  const query = await searchParams;
  await applyDefaultListView(user.id, TARGET, PATH, query);
  const [allHolds, allRows] = await Promise.all([listHolds(), retentionDryRun()]);
  const active = allHolds.filter((hold) => !hold.releasedAt);
  const holdSort = parseColumnSort(query, HOLD_COLUMNS);
  const holdValue: Record<(typeof HOLD_COLUMNS)[number], (hold: (typeof allHolds)[number]) => unknown> = {
    hold_ref: (hold) => hold.reference,
    hold_covers: (hold) => `${hold.scopeType} ${hold.scopeLabel}`,
    hold_owner: (hold) => hold.ownerName,
    hold_placed: (hold) => hold.createdAt,
    hold_status: (hold) => (hold.releasedAt ? "Released" : "Active"),
  };
  const holds = holdSort.sortBy ? sortRows(allHolds, holdValue[holdSort.sortBy], holdSort.dir) : allHolds;
  const rowSort = parseColumnSort(query, RETENTION_COLUMNS);
  const rowValue: Record<(typeof RETENTION_COLUMNS)[number], (row: (typeof allRows)[number]) => unknown> = {
    ret_records: (row) => row.label,
    ret_kept: (row) => (row.duration ? row.duration * (row.unit === "years" ? 365 : row.unit === "months" ? 30 : 1) : null), // in days
    ret_past: (row) => (row.duration ? row.eligible : null),
    ret_held: (row) => (row.duration ? row.held : null),
    ret_oldest: (row) => row.oldest,
  };
  const dryRun = rowSort.sortBy ? sortRows(allRows, rowValue[rowSort.sortBy], rowSort.dir) : allRows;
  const holdHead = sortHeads(PATH, query, holdSort);
  const rowHead = sortHeads(PATH, query, rowSort);

  return (
    <>
      <PageHeader title="Retention & legal holds" description="Holds keep records from being deleted while a matter is open. Retention shows what a policy would affect; these policies delete nothing by themselves. Separately, security records (sign-in attempts, WhatsApp codes, ended sessions, used links) are deleted after 90 days (DR-06)." />

      <ListViews userId={user.id} target={TARGET} path={PATH} query={query} />
      <section aria-labelledby="holds-title" className="card mb-6 px-5 py-4">
        <div className="mb-3 flex items-center gap-1.5">
          <h2 id="holds-title" className="font-semibold">
            Legal holds ({active.length} active)
          </h2>
          <Hint text="A held request can't be deleted (not even by the Super Admin), and housekeeping keeps its related records. Release a hold when the matter closes." align="start" />
        </div>
        {holds.length > 0 && (
          <div className="table-cards mb-4 overflow-x-auto">
            <table className="data-table">
              <caption className="sr-only">Legal holds</caption>
              <thead>
                <tr>
                  {holdHead("Reference", "hold_ref")}
                  {holdHead("Covers", "hold_covers")}
                  {holdHead("Owner", "hold_owner")}
                  {holdHead("Placed", "hold_placed")}
                  {holdHead("Status", "hold_status")}
                </tr>
              </thead>
              <PagedRows colSpan={5}>
                {holds.map((hold) => (
                  <tr key={hold.id}>
                    <td className="min-w-48">
                      <span className="font-semibold">{hold.reference}</span>
                      <span className="block text-caption text-ink-muted">{hold.reason}</span>
                    </td>
                    <td data-label="Covers" className="text-label">
                      {hold.scopeType === "REQUEST" ? "Request " : hold.scopeType === "REQUESTER" ? "Everything raised by " : "Every request of "}
                      {hold.scopeLabel}
                      <span className="block text-caption text-ink-muted">
                        {hold.covered} request{hold.covered === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td data-label="Owner" className="text-label">{hold.ownerName}</td>
                    <td data-label="Placed" className="text-label">
                      {formatIndiaTime(hold.createdAt)}
                      <span className="block text-caption text-ink-muted">by {hold.createdByName}</span>
                    </td>
                    <td data-label="Status" className="min-w-56">
                      {hold.releasedAt ? (
                        <span className="text-label">
                          <Badge tone="neutral">Released</Badge> {formatIndiaTime(hold.releasedAt)}
                          <span className="block text-caption text-ink-muted">{hold.releaseReason}</span>
                        </span>
                      ) : (
                        <>
                          <Badge tone="warning">Active</Badge>
                          <ReleaseHoldForm holdId={hold.id} reference={hold.reference} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </PagedRows>
            </table>
          </div>
        )}
        <h3 className="mb-2 text-label font-semibold">Place a hold</h3>
        <CreateHoldForm />
      </section>

      <section aria-labelledby="retention-title" className="card px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <h2 id="retention-title" className="font-semibold">
              Retention (dry run)
            </h2>
            <Hint text="What the current retention settings would affect today. Nothing is archived or deleted: a clean-up run needs an approved policy and a separate decision." align="start" />
          </div>
          <Link href="#settings-RETENTION" className="link text-label">
            Set durations
          </Link>
        </div>
        <div className="table-cards overflow-x-auto">
          <table className="data-table">
            <caption className="sr-only">Retention dry run</caption>
            <thead>
              <tr>
                {rowHead("Records", "ret_records")}
                {rowHead("Kept for", "ret_kept")}
                {rowHead("Past the date", "ret_past", { className: "text-right" })}
                {rowHead("Kept by a hold", "ret_held", { className: "text-right" })}
                {rowHead("Oldest", "ret_oldest")}
              </tr>
            </thead>
            <PagedRows colSpan={5}>
              {dryRun.map((row) => (
                <tr key={row.key}>
                  <td className="text-label">{row.label}</td>
                  <td data-label="Kept for" className="text-label">{row.duration ? `${row.duration} ${row.unit}` : <Badge tone="neutral">Not set: kept for ever</Badge>}</td>
                  <td data-label="Past the date" className="text-right tabular-nums">{row.duration ? row.eligible.toLocaleString("en-IN") : "—"}</td>
                  <td data-label="Kept by a hold" className="text-right tabular-nums">{row.duration ? row.held.toLocaleString("en-IN") : "—"}</td>
                  <td data-label="Oldest" className="text-label">{row.oldest ? formatIndiaTime(row.oldest) : "—"}</td>
                </tr>
              ))}
            </PagedRows>
          </table>
        </div>
      </section>

      {/* v1.84.0 (D-411, owner's redesign): the retention values moved here from Providers & security. */}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsGroupSection group="RETENTION" testId="settings-retention" />
        <SettingsHistory groups={["RETENTION"]} />
      </div>
    </>
  );
}
