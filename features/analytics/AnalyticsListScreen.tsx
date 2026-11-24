import { requireFeature } from "@/server/settings/feature-guard";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { ListPage } from "@/features/ui/ListPage";
import { PageHeader } from "@/features/shell/PageHeader";
import { Breadcrumbs } from "@/features/ui/Display";
import { RequestStatusPill } from "@/features/requests/StatusPill";
import { resolveScope } from "@/server/analytics/scope";
import { indiaToday, resolvePeriod } from "@/server/analytics/periods";
import { DRILL_LABEL, loadDrill, type DrillKind } from "@/lib/db/repositories/analytics-more.repository";
import { dashboardChoices } from "@/lib/db/repositories/dashboards.repository";
import { readFilter, SLA_FILTER_LABEL, STATUS_FILTER_LABEL, withParams } from "@/server/analytics/query";
import { AGING_BUCKETS } from "@/server/analytics/semantics";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { guardAnalyticsRate } from "@/server/analytics/rate";
import type { AnalyticsBase } from "@/features/analytics/AnalyticsScreen";
import type { InstanceStatus } from "@/server/engine/types";
import { SortTh } from "@/features/ui/SortTh";
import { nextDir, parseColumnSort, sortHref, sortRows } from "@/server/lists/sorting";

// v1.58.0 (D-351, owner): every column of the drill-down list sorts both ways (on the rows shown, at most 500).
const DRILL_SORTS = ["request", "type", "raiser", "status", "raised", "closed"] as const;

// v1.7.0 (B01): the requests behind an Analytics number, with the same
// scope and filters (read the same way as the dashboard), so the list and
// the number agree. Scope is checked again on the server.
export async function AnalyticsListScreen({ searchParams, base }: { searchParams: Record<string, string | undefined>; base: AnalyticsBase }) {
  const { user } = await requireArea("users");
  // v1.72.1 (D-395): a switched-off feature says so (not a 404).
  await requireFeature("analytics", user);
  const query = searchParams;
  const kind = (query.kind && query.kind in DRILL_LABEL ? query.kind : null) as DrillKind | null;
  // v1.74.1 (D-397): an address without a (known) number opens the dashboard, not a 404.
  if (!kind) redirect(base);
  const viewer = { id: user.id, roles: user.roles };
  const { scope } = await resolveScope(query.scope, viewer);
  const period = resolvePeriod({ key: query.period, from: query.from, to: query.to }, indiaToday(new Date()));
  const choices = await dashboardChoices();
  const { filter, carried } = readFilter(query, { scope, period, typeIds: choices.types.map((type) => type.id), departmentIds: choices.departments.map((department) => department.id) });
  const back = withParams(base, carried);
  if (await guardAnalyticsRate(user.id)) {
    return (
      <p role="alert" className="card px-4 py-3 text-label text-warning-600">
        Analytics was opened many times in the last minute. Wait a minute, then reload the page.
      </p>
    );
  }
  const loaded = await loadDrill(kind, scope, viewer, filter);
  const truncated = loaded.truncated;
  const sort = parseColumnSort(query, DRILL_SORTS);
  const drillValue = (row: (typeof loaded.rows)[number]): unknown => {
    switch (sort.sortBy) {
      case "request":
        return row.requestNo;
      case "type":
        return row.workflowName;
      case "raiser":
        return row.requesterName;
      case "status":
        return row.status;
      case "raised":
        return row.submittedAt;
      default:
        return row.closedAt;
    }
  };
  const rows = sort.sortBy ? sortRows(loaded.rows, drillValue, sort.dir) : loaded.rows;
  const drillPath = `${base}/list`;
  const th = (column: (typeof DRILL_SORTS)[number], label: string) => <SortTh label={label} column={column} sortBy={sort.sortBy} dir={sort.dir} href={sortHref(drillPath, query, column, nextDir(sort, column))} />;
  const conditions = [
    carried.type && (carried.type === "-1" ? "custom approvals" : choices.types.find((type) => String(type.id) === carried.type)?.name),
    carried.department && choices.departments.find((department) => String(department.id) === carried.department)?.name,
    filter.status && `status ${STATUS_FILTER_LABEL[filter.status].toLowerCase()}`,
    filter.step && `step “${filter.step}”`,
    filter.approverId && "one approver",
    filter.sla && SLA_FILTER_LABEL[filter.sla].toLowerCase(),
    filter.aging && `open ${AGING_BUCKETS.find((bucket) => bucket.key === filter.aging)?.label.toLowerCase()}`,
  ].filter(Boolean);
  const periodBound = ["raised", "approved", "rejected", "withdrawn", "sent_back"].includes(kind);

  return (
    <ListPage
      header={
        <>
          <Breadcrumbs items={[{ href: base === "/admin/insights/analytics" ? "/admin" : "/users", label: base === "/admin/insights/analytics" ? "Admin" : "Home" }, { href: back, label: "Analytics" }, { label: DRILL_LABEL[kind] }]} />
          <PageHeader title={DRILL_LABEL[kind]} meta={`${scope.label}${periodBound ? ` · ${period.label} (${period.from} to ${period.to})` : " · right now"}${conditions.length ? ` · ${conditions.join(" · ")}` : ""}`}>
          <Link href={back} className="link text-label">
            ← Back to Analytics
          </Link>
          </PageHeader>
        </>
      }
    >
      <p className="mb-2 text-caption text-ink-muted" role="status">
        {rows.length === 0 ? "No requests match." : `${rows.length.toLocaleString("en-IN")} request${rows.length === 1 ? "" : "s"}${truncated ? " (the first 500; narrow the filters to see the rest)" : ""}.`}
        {kind === "sent_back" ? " The number on Analytics counts send-backs; a request sent back twice is listed once." : ""}
      </p>
      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="drill-table">
            <caption className="sr-only">{DRILL_LABEL[kind]}</caption>
            <thead>
              <tr>
                {th("request", "Request")}
                {th("type", "Approval type")}
                {th("raiser", "Raised by")}
                {th("status", "Status")}
                {th("raised", "Raised")}
                {th("closed", "Closed")}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/users/requests/${row.id}`} className="link">
                      {row.requestNo}
                    </Link>
                    <span className="block max-w-80 truncate text-caption text-ink-muted">{row.title}</span>
                  </td>
                  <td data-label="Approval type">{row.workflowName}</td>
                  <td data-label="Raised by">{row.requesterName}</td>
                  <td data-label="Status">
                    <RequestStatusPill status={row.status as InstanceStatus} />
                  </td>
                  <td data-label="Raised" className="whitespace-nowrap">{formatIndiaTime(row.submittedAt)}</td>
                  <td data-label="Closed" className="whitespace-nowrap">{row.closedAt ? formatIndiaTime(row.closedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPage>
  );
}
