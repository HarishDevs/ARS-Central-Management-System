import type { Metadata } from "next";
import { PagedRows } from "@/features/ui/PagedRows";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { loadInsights } from "@/lib/db/repositories/insights.repository";
import { ListViews } from "@/features/lists/ListViews";
import { SortHead } from "@/features/admin/SortHead";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows, type ColumnSort } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner): every column of every table sorts both ways (one
// table at a time: the column keys are "<table>_<column number>"); saved
// views (list_admin_insights). No Group by: these tables are already totals
// (by level, person and month).
const PATH = "/admin/insights";
const TABLES = { step: 3, speed: 5, overdue: 4, person: 5, month: 6 } as const;
const COLUMNS = Object.entries(TABLES).flatMap(([id, count]) => Array.from({ length: count }, (_, index) => `${id}_${index}`));

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Insights" };

// F-70 / D-069 management dashboard: headline numbers as tiles, the detail
// as plain tables (exact values matter more than shapes here).
function hours(value: number | null): string {
  if (value === null) return "—";
  if (value * 60 < 1) return "under 1 min";
  if (value < 1) return `${Math.round(value * 60)} min`;
  if (value < 48) return `${value.toFixed(1)} h`;
  return `${(value / 24).toFixed(1)} days`;
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1)).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

// v1.74.1 (D-397): `textColumns` = how many leading columns are words (the rest are numbers, set to the right);
// `wide` spans both columns of the grid (the month table was cut off at half width).
function Table({ id, title, empty, head, rows, values, query, sort, textColumns = 2, wide = false }: { id: keyof typeof TABLES; title: string; empty: string; head: string[]; rows: React.ReactNode[][]; values: unknown[][]; query: Record<string, unknown>; sort: ColumnSort; textColumns?: number; wide?: boolean }) {
  // This table's sort (another table's column leaves it in its own order).
  const column = sort.sortBy?.startsWith(`${id}_`) ? Number(sort.sortBy.slice(id.length + 1)) : null;
  const order = rows.map((_, index) => index);
  const sorted = column === null ? order : sortRows(order, (index) => values[index]?.[column], sort.dir);
  return (
    <section className={`card table-cards overflow-x-auto ${wide ? "xl:col-span-2" : ""}`}>
      <h2 className="border-b border-line px-5 py-4 font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-label text-ink-muted">{empty}</p>
      ) : (
        <table className="data-table max-md:p-3">
          <SortHead path={PATH} query={query} sort={sort} columns={head.map((cell, index) => ({ key: `${id}_${index}`, label: cell, className: index >= textColumns ? "text-right" : undefined }))} />
          <PagedRows colSpan={1}>
            {sorted.map((rowIndex) => (
              <tr key={rowIndex}>
                {rows[rowIndex]!.map((cell, index) => (
                  <td key={index} data-label={index === 0 ? undefined : head[index]} className={index >= textColumns ? "text-right tabular-nums" : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </PagedRows>
        </table>
      )}
    </section>
  );
}

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await requireArea("admin");
  const query = await searchParams;
  await applyDefaultListView(user.id, "list_admin_insights", PATH, query);
  const sort = parseColumnSort(query, COLUMNS);
  const data = await loadInsights();
  const tiles = [
    { label: "Open requests", value: data.totals.open.toLocaleString("en-IN") },
    { label: "Overdue approvals", value: data.totals.overdue.toLocaleString("en-IN"), alert: data.totals.overdue > 0 },
    { label: "Approved, last 30 days", value: data.totals.approved30.toLocaleString("en-IN") },
    { label: "Average time to full approval (90 days)", value: hours(data.totals.avgHoursToApprove90) },
  ];
  return (
    <>
      <PageHeader title="Insights" description="Where requests are waiting, how long each level takes, and who is deciding. Updated live." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card p-5">
            <p className="text-label text-ink-muted">{tile.label}</p>
            <p className={`mt-2 text-display font-bold tabular-nums ${tile.alert ? "text-danger-600" : ""}`}>{tile.value}</p>
            {tile.alert && <p className="text-caption text-danger-600">See the overdue list below</p>}
          </div>
        ))}
      </div>
      <ListViews userId={user.id} target="list_admin_insights" path={PATH} query={query} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Table
          title="Waiting now, by level"
          empty="Nothing is waiting."
          head={["Approval type", "Level", "Requests"]}
          rows={data.openByStep.map((row) => [row.workflow, row.level, row.requests])}
          values={data.openByStep.map((row) => [row.workflow, row.level, row.requests])}
          id="step"
          query={query}
          sort={sort}
        />
        <Table
          title="Time to decide, per level (last 90 days)"
          empty="No decisions yet."
          head={["Approval type", "Level", "Decisions", "Average", "Slowest"]}
          rows={data.speedByLevel.map((row) => [row.workflow, row.level, row.decisions, hours(row.avgHours), hours(row.maxHours)])}
          values={data.speedByLevel.map((row) => [row.workflow, row.level, row.decisions, row.avgHours, row.maxHours])}
          id="speed"
          query={query}
          sort={sort}
        />
        <Table
          title="Overdue approvals"
          empty="Nothing is overdue."
          head={["Request", "Level", "Approver", "Overdue by"]}
          rows={data.overdue.map((row) => [
            <Link key="link" href={`/users/requests/${row.requestId}`} className="link">
              {row.requestNo}
            </Link>,
            row.level,
            row.approver,
            hours(row.hoursOverdue),
          ])}
          values={data.overdue.map((row) => [row.requestNo, row.level, row.approver, row.hoursOverdue])}
          id="overdue"
          query={query}
          sort={sort}
          textColumns={3}
        />
        <Table
          title="Decisions by person (last 30 days)"
          empty="No decisions in the last 30 days."
          head={["Person", "Approved", "Rejected", "Changes asked", "Average time"]}
          rows={data.byPerson.map((row) => [row.name, row.approved, row.rejected, row.changes, hours(row.avgHours)])}
          values={data.byPerson.map((row) => [row.name, row.approved, row.rejected, row.changes, row.avgHours])}
          id="person"
          query={query}
          sort={sort}
          textColumns={1}
        />
        <Table
          title="Requests by month (last 6 months)"
          empty="No requests yet."
          head={["Month", "Raised", "Approved", "Rejected", "Withdrawn", "Still open"]}
          rows={data.byMonth.map((row) => [monthLabel(row.month), row.raised, row.approved, row.rejected, row.withdrawn, row.open])}
          values={data.byMonth.map((row) => [row.month, row.raised, row.approved, row.rejected, row.withdrawn, row.open])}
          id="month"
          query={query}
          sort={sort}
          textColumns={1}
          wide
        />
      </div>
    </>
  );
}
