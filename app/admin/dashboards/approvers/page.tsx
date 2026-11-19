import type { Metadata } from "next";
import { DashboardFrame, DashboardTable, KpiTiles, MeasureBar } from "@/features/admin/dashboards/DashboardFrame";
import { dashboardPage, type DashboardSearch } from "@/features/admin/dashboards/page-data";
import { loadApprovers } from "@/lib/db/repositories/dashboards.repository";
import { hoursText, percent } from "@/server/dashboards/filters";
import { requireArea } from "@/server/authorization/guards";
import { departmentBucket } from "@/server/lists/group-rows";

// v1.58.0 (D-354, owner): every column sorts both ways; Group by Department or
// Overdue now (folded at first); saved views (list_admin_dash_approvers).
const GROUPS = [
  { key: "department", label: "Department" },
  { key: "overdue", label: "Overdue now" },
] as const;

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Approvers dashboard" };

// Approver-wise (F-74): approvals given to each person in the period.
export default async function ApproversDashboardPage({ searchParams }: { searchParams: DashboardSearch }) {
  // D-244 (audit SEC-02): the page checks its own area too (not only the
  // screen it renders, nor the layout).
  await requireArea("admin");
  const { today, filter, choices, query, userId } = await dashboardPage(searchParams, "approvers");
  const group = GROUPS.find((choice) => choice.key === query.group)?.key ?? null;
  const rows = await loadApprovers(filter);
  const assigned = rows.reduce((sum, row) => sum + row.assigned, 0);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  const overdue = rows.reduce((sum, row) => sum + row.overdue, 0);
  const decided = rows.reduce((sum, row) => sum + row.approved + row.rejected + row.changes, 0);
  const timed = rows.filter((row) => row.onTimePercent !== null);
  const onTime = timed.length ? Math.round(timed.reduce((sum, row) => sum + (row.onTimePercent ?? 0), 0) / timed.length) : null;
  const decidedShare = percent(decided, assigned);
  const max = Math.max(0, ...rows.map((row) => row.assigned));
  return (
    <DashboardFrame
      slug="approvers"
      filter={filter}
      today={today}
      choices={choices}
      departmentNote="Department = the approver's department. A delegate's decision counts for the approver."
      query={query}
      userId={userId}
      groups={GROUPS}
    >
      <KpiTiles
        tiles={[
          { label: "Approvals given", value: assigned.toLocaleString("en-IN"), note: `${rows.length} approvers` },
          { label: "Decided", value: decided.toLocaleString("en-IN"), note: decidedShare === null ? undefined : `${decidedShare}% of those given` },
          { label: "Waiting now", value: pending.toLocaleString("en-IN"), note: overdue ? `${overdue} overdue` : "none overdue" },
          { label: "Decided on time", value: onTime === null ? "—" : `${onTime}%`, note: "average across approvers with a response time" },
        ]}
      />
      <DashboardTable
        path="/admin/dashboards/approvers"
        query={query}
        values={rows.map((row) => [row.name, row.assigned, row.approved, row.rejected, row.changes, row.notNeeded, row.pending, row.overdue, row.avgDecideHours, row.onTimePercent])}
        groupOf={group ? (index) => (group === "department" ? departmentBucket(rows[index]!.department) : rows[index]!.overdue ? ["Has overdue", 0] : ["Nothing overdue", 1]) : null}
        empty="No approvals were given in this period."
        head={[
          { label: "Approver" },
          { label: "Given" },
          { label: "Approved", numeric: true },
          { label: "Rejected", numeric: true },
          { label: "Changes asked", numeric: true },
          { label: "Not needed", numeric: true, hint: "An any-one or any-N step that someone else in the step completed first." },
          { label: "Waiting now", numeric: true },
          { label: "Overdue now", numeric: true },
          { label: "Avg to decide", numeric: true },
          { label: "On time", numeric: true, hint: "Decided within the step's response time." },
        ]}
        rows={rows.map((row) => [
          <span key="name">
            {row.name}
            <span className="block text-caption text-ink-muted">{[row.designation, row.department].filter(Boolean).join(" · ") || "—"}</span>
          </span>,
          <MeasureBar key="given" value={row.assigned} max={max} />,
          row.approved,
          row.rejected,
          row.changes,
          row.notNeeded,
          row.pending,
          row.overdue ? (
            <span key="overdue" className="font-semibold text-danger-600">
              {row.overdue}
            </span>
          ) : (
            0
          ),
          hoursText(row.avgDecideHours),
          row.onTimePercent === null ? "—" : `${row.onTimePercent}%`,
        ])}
      />
    </DashboardFrame>
  );
}
