import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { BudgetForm } from "@/features/admin/BudgetForm";
import { Badge } from "@/features/ui/Display";
import { listBudgets } from "@/lib/db/repositories/budgets.repository";
import { budgetPosition, financialYear, fyLabel } from "@/server/workflows/type-settings";
import { formatPaise } from "@/server/forms/dynamic";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { ListPage } from "@/features/ui/ListPage";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { ListViews } from "@/features/lists/ListViews";
import { FoldScope } from "@/features/ui/GroupFold";
import { SortHead } from "@/features/admin/SortHead";
import { GroupedRows } from "@/features/admin/GroupedRows";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { groupRows, pickGroup } from "@/server/lists/group-rows";
import { budgetBucket, groupHref, groupMenu } from "@/server/admin/lists";

// v1.58.0 (D-354, owner): every column sorts both ways; Group by budget
// position (folded at first); saved views (list_admin_budgets). The rows are
// departments, so Department is not a group here.
const PATH = "/admin/setup/budgets";
const COLUMNS = ["department", "committed", "available", "status", "budget"] as const;
const GROUPS = [{ key: "position", label: "Budget position" }] as const;

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Budgets" };

// EN-09 department budgets. Committed = amounts of open and approved
// requests checked against the budget at submit. A department without a
// budget shows "No budget loaded", never "unlimited".
export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ fy?: string; sortBy?: string; dir?: string; group?: string }> }) {
  const { user } = await requireArea("admin");
  const query = await searchParams;
  await applyDefaultListView(user.id, "list_admin_budgets", PATH, query);
  const current = financialYear(new Date());
  const raw = Number(query.fy);
  const fy = Number.isInteger(raw) && raw >= current - 5 && raw <= current + 1 ? raw : current;
  const loaded = (await listBudgets(fy)).map((row) => ({ ...row, position: budgetPosition({ budgetPaise: row.budgetPaise, warnPercent: row.warnPercent, committedPaise: row.committedPaise, requestPaise: 0 }) }));
  type Loaded = (typeof loaded)[number];
  const sort = parseColumnSort(query, COLUMNS);
  const group = pickGroup(query.group, GROUPS.map((choice) => choice.key));
  const value = (row: Loaded): unknown =>
    sort.sortBy === "department" ? row.departmentName : sort.sortBy === "committed" ? row.committedPaise : sort.sortBy === "available" ? (row.budgetPaise === null ? null : row.budgetPaise - row.committedPaise) : sort.sortBy === "status" ? (row.position.state === "NO_BUDGET" ? null : (row.position.usedPercent ?? 0)) : row.budgetPaise;
  const rows = sort.sortBy ? sortRows(loaded, value, sort.dir) : loaded;
  const groups = group ? groupRows(rows, (row) => budgetBucket(row.position.state)) : null;
  return (
    <>
      <ListPage
        title="Budgets"
        description={`Department budgets for ${fyLabel(fy)} (April to March, India time). Approval types with the budget check switched on warn requesters and approvers.`}
        action={
        <nav aria-label="Financial year" className="flex flex-wrap gap-2 text-label">
          {[current - 1, current, current + 1].map((year) => (
            <Link key={year} href={groupHref(PATH, { ...query, fy: String(year) }, group)} aria-current={year === fy ? "page" : undefined} className={year === fy ? "btn-primary btn-compact" : "btn-secondary btn-compact"}>
              {fyLabel(year)}
            </Link>
          ))}
        </nav>
        }
        toolbar={<ListToolbar id="budgets-view" path={PATH} label="Budgets view" keep={{}} filterCount={0} clearHref={null} group={groupMenu(PATH, query, GROUPS, group)} />}
      >
      <ListViews userId={user.id} target="list_admin_budgets" path={PATH} query={query} />
      <FoldScope enabled={Boolean(group)}>
      <div className="card overflow-x-auto">
        <table className="data-table">
          <caption className="sr-only">Department budgets for {fyLabel(fy)}</caption>
          <SortHead
            path={PATH}
            query={query}
            sort={sort}
            columns={[
              { key: "department", label: "Department" },
              { key: "committed", label: "Committed", className: "text-right" },
              { key: "available", label: "Available", className: "text-right" },
              { key: "status", label: "Status" },
              { key: "budget", label: "Budget (₹) · warn at %" },
            ]}
          />
          <GroupedRows
            rows={rows}
            groups={groups}
            colSpan={5}
            paged={false}
            render={(row) => {
              const position = row.position;
              return (
                <tr key={row.departmentId}>
                  <td>
                    {row.departmentName}
                    <span className="block text-caption text-ink-muted">{row.updatedAt ? `Updated ${formatIndiaTime(row.updatedAt)} by ${row.updatedByName ?? "IT"}` : "No budget loaded"}</span>
                  </td>
                  <td data-label="Committed" className="text-right tabular-nums">
                    {formatPaise(row.committedPaise)}
                    <span className="block text-caption text-ink-muted">{row.requests} request(s)</span>
                  </td>
                  <td data-label="Available" className="text-right tabular-nums">{row.budgetPaise === null ? <span className="text-ink-faint">—</span> : formatPaise(row.budgetPaise - row.committedPaise)}</td>
                  <td data-label="Status">
                    {position.state === "NO_BUDGET" ? (
                      <Badge tone="neutral">No budget loaded</Badge>
                    ) : position.state === "OVER" ? (
                      <Badge tone="danger">Over budget · {position.usedPercent}%</Badge>
                    ) : position.state === "WARN" ? (
                      <Badge tone="warning">{position.usedPercent}% used</Badge>
                    ) : (
                      <Badge tone="success">{position.usedPercent ?? 0}% used</Badge>
                    )}
                  </td>
                  <td data-label="Budget (₹) · warn at %">
                    <BudgetForm departmentId={row.departmentId} departmentName={row.departmentName} fy={fy} amountRupees={row.budgetPaise === null ? "" : String(row.budgetPaise / 100)} warnPercent={row.warnPercent} />
                  </td>
                </tr>
              );
            }}
          />
          {rows.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={5} className="text-ink-muted">
                  No departments yet. Add them under Departments.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      </FoldScope>
      </ListPage>
    </>
  );
}
