import type { Metadata } from "next";
import { Fragment } from "react";
import { DashboardFrame, KpiTiles, OutcomeBar, OutcomeLegend } from "@/features/admin/dashboards/DashboardFrame";
import { dashboardPage, type DashboardSearch } from "@/features/admin/dashboards/page-data";
import { loadRaisers, type RaiserRow } from "@/lib/db/repositories/dashboards.repository";
import { approvalRate, hoursText } from "@/server/dashboards/filters";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { requireArea } from "@/server/authorization/guards";
import { SortHead } from "@/features/admin/SortHead";
import { compareValues, parseColumnSort, sortRows } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner): every column sorts both ways: the raisers inside each
// department, and the departments by their subtotal (by name for "Raised by").
// No Group by choice: this table is already grouped by department, with a
// subtotal row each. Saved views (list_admin_dash_raisers).
const PATH = "/admin/insights/dashboards/raisers";
const COLUMNS = ["name", "raised", "outcome", "approved", "rejected", "open", "rate", "close", "last"] as const;
type Column = (typeof COLUMNS)[number];
function value(row: RaiserRow, column: Column): unknown {
  if (column === "outcome" || column === "rate") return approvalRate(row.approved, row.rejected);
  if (column === "close") return row.avgCloseHours;
  if (column === "last") return row.lastRaisedAt;
  return row[column];
}
function subtotal(department: string, people: RaiserRow[], column: Column): unknown {
  if (column === "name") return department;
  if (column === "outcome" || column === "rate") return approvalRate(total(people, "approved"), total(people, "rejected"));
  if (column === "close") return null;
  if (column === "last") return people.reduce<Date | null>((latest, row) => (row.lastRaisedAt && (!latest || row.lastRaisedAt > latest) ? row.lastRaisedAt : latest), null);
  return total(people, column);
}

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Raisers dashboard" };

type Measure = "raised" | "approved" | "rejected" | "open" | "withdrawn";
const total = (items: RaiserRow[], key: Measure) => items.reduce((sum, item) => sum + item[key], 0);
const rateText = (approved: number, rejected: number) => {
  const rate = approvalRate(approved, rejected);
  return rate === null ? "—" : `${rate}%`;
};

// Raiser-wise by department (F-74): each raiser under their department, with
// a subtotal row per department.
export default async function RaisersDashboardPage({ searchParams }: { searchParams: DashboardSearch }) {
  // D-244 (audit SEC-02): the page checks its own area too (not only the
  // screen it renders, nor the layout).
  await requireArea("admin");
  const { today, filter, choices, query, userId } = await dashboardPage(searchParams, "raisers");
  const rows = await loadRaisers(filter);
  const sort = parseColumnSort(query, COLUMNS);
  const byDepartment = new Map<string, RaiserRow[]>();
  for (const row of rows) byDepartment.set(row.department, [...(byDepartment.get(row.department) ?? []), row]);
  let groups = [...byDepartment];
  if (sort.sortBy) {
    const column = sort.sortBy;
    groups = groups.map(([department, people]) => [department, sortRows(people, (row) => value(row, column), sort.dir)] as [string, RaiserRow[]]);
    if (column !== "close") {
      const factor = sort.dir === "desc" ? -1 : 1;
      groups.sort((a, b) => compareValues(subtotal(a[0], a[1], column), subtotal(b[0], b[1], column)) * factor);
    }
  }
  const raised = total(rows, "raised");
  const top = [...rows].sort((a, b) => b.raised - a.raised)[0];
  return (
    <DashboardFrame slug="raisers" filter={filter} today={today} choices={choices} departmentNote="Department = the raiser's department today." query={query} userId={userId}>
      <KpiTiles
        tiles={[
          { label: "Requests raised", value: raised.toLocaleString("en-IN") },
          { label: "People raising", value: rows.length.toLocaleString("en-IN") },
          { label: "Average per person", value: rows.length ? (raised / rows.length).toFixed(1) : "—" },
          { label: "Raises the most", value: top ? top.name : "—", note: top ? `${top.raised} · ${top.department}` : undefined },
        ]}
      />
      <section className="card table-cards overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-label text-ink-muted">No requests in this period.</p>
        ) : (
          <>
            <OutcomeLegend />
            <table className="data-table">
              <SortHead
                path={PATH}
                query={query}
                sort={sort}
                columns={[
                  { key: "name", label: "Raised by" },
                  { key: "raised", label: "Raised", className: "text-right" },
                  { key: "outcome", label: "Outcome" },
                  { key: "approved", label: "Approved", className: "text-right" },
                  { key: "rejected", label: "Rejected", className: "text-right" },
                  { key: "open", label: "Open", className: "text-right" },
                  { key: "rate", label: "Approval rate", className: "text-right" },
                  { key: "close", label: "Avg to close", className: "text-right" },
                  { key: "last", label: "Last raised" },
                ]}
              />
              <tbody>
                {groups.map(([department, people]) => (
                  <Fragment key={department}>
                    <tr className="bg-surface-muted">
                      <th scope="rowgroup" className="min-w-48 px-4 py-2 text-left !text-label !font-semibold !normal-case !tracking-normal !text-ink">
                        {department} <span className="font-normal text-ink-muted">· {people.length === 1 ? "1 person" : `${people.length} people`}</span>
                      </th>
                      <td data-label="Raised" className="text-right font-semibold tabular-nums">{total(people, "raised")}</td>
                      <td data-label="Outcome">
                        <OutcomeBar approved={total(people, "approved")} rejected={total(people, "rejected")} open={total(people, "open")} withdrawn={total(people, "withdrawn")} />
                      </td>
                      <td data-label="Approved" className="text-right tabular-nums">{total(people, "approved")}</td>
                      <td data-label="Rejected" className="text-right tabular-nums">{total(people, "rejected")}</td>
                      <td data-label="Open" className="text-right tabular-nums">{total(people, "open")}</td>
                      <td data-label="Approval rate" className="text-right tabular-nums">{rateText(total(people, "approved"), total(people, "rejected"))}</td>
                      <td data-label="Avg to close" />
                      <td data-label="Last raised" />
                    </tr>
                    {people.map((row) => (
                      <tr key={row.requesterId}>
                        <td data-card-title="" className="pl-8">{row.name}</td>
                        <td data-label="Raised" className="text-right tabular-nums">{row.raised}</td>
                        <td data-label="Outcome">
                          <OutcomeBar approved={row.approved} rejected={row.rejected} open={row.open} withdrawn={row.withdrawn} />
                        </td>
                        <td data-label="Approved" className="text-right tabular-nums">{row.approved}</td>
                        <td data-label="Rejected" className="text-right tabular-nums">{row.rejected}</td>
                        <td data-label="Open" className="text-right tabular-nums">{row.open}</td>
                        <td data-label="Approval rate" className="text-right tabular-nums">{rateText(row.approved, row.rejected)}</td>
                        <td data-label="Avg to close" className="text-right tabular-nums">{hoursText(row.avgCloseHours)}</td>
                        <td data-label="Last raised" className="whitespace-nowrap text-label text-ink-muted">{row.lastRaisedAt ? formatIndiaTime(row.lastRaisedAt) : "—"}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </DashboardFrame>
  );
}
