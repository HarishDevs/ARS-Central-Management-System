import { EmptyState } from "@/features/ui/Display";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { departmentNamesOf, listPendingTaskAges } from "@/lib/db/repositories/workload.repository";
import { AGE_BANDS, ageText, summarizeWorkload, type WorkloadRow } from "@/server/workload/summary";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { ListViews } from "@/features/lists/ListViews";
import { FoldScope } from "@/features/ui/GroupFold";
import { SortHead } from "@/features/admin/SortHead";
import { GroupedRows } from "@/features/admin/GroupedRows";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort, sortRows } from "@/server/lists/sorting";
import { departmentBucket, groupRows, pickGroup } from "@/server/lists/group-rows";
import { groupMenu, oldestBucket } from "@/server/admin/lists";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Workload" };

// v1.58.0 (D-354, owner): every column sorts both ways; Group by Department,
// Overdue or Oldest wait (folded at first); saved views (list_admin_workload).
const PATH = "/admin/workload";
const COLUMNS = ["name", "department", "pending", "overdue", ...AGE_BANDS.map((band) => `band_${band.key}`), "median", "oldest"] as const;
const GROUPS = [
  { key: "department", label: "Department" },
  { key: "overdue", label: "Overdue" },
  { key: "oldest", label: "Oldest wait" },
] as const;
type Row = WorkloadRow & { department: string | null };

function sortValue(row: Row, column: string): unknown {
  if (column.startsWith("band_")) return row.bands[column.slice(5) as keyof WorkloadRow["bands"]];
  if (column === "median") return row.medianHours;
  if (column === "oldest") return row.oldestHours;
  return row[column as "name" | "department" | "pending" | "overdue"];
}

// #12 workload: who has how much waiting right now, its age and what is
// overdue. A person's page has "Hand over pending approvals".
export default async function WorkloadPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await requireArea("admin");
  const query = await searchParams;
  await applyDefaultListView(user.id, "list_admin_workload", PATH, query);
  const summary = summarizeWorkload(await listPendingTaskAges());
  const departments = await departmentNamesOf(summary.rows.map((row) => row.approverId));
  const { total, overdue, medianHours } = summary;
  const all: Row[] = summary.rows.map((row) => ({ ...row, department: departments.get(row.approverId) ?? null }));
  const sort = parseColumnSort(query, COLUMNS);
  const group = pickGroup(query.group, GROUPS.map((choice) => choice.key));
  const rows = sort.sortBy ? sortRows(all, (row) => sortValue(row, sort.sortBy!), sort.dir) : all;
  const groups = group
    ? groupRows(rows, (row) => (group === "department" ? departmentBucket(row.department) : group === "overdue" ? (row.overdue ? ["Has overdue", 0] : ["Nothing overdue", 1]) : oldestBucket(row.oldestHours)))
    : null;
  const tiles = [
    { label: "Waiting now", value: total.toLocaleString("en-IN") },
    { label: "Overdue", value: overdue.toLocaleString("en-IN"), alert: overdue > 0 },
    { label: "People with something waiting", value: all.length.toLocaleString("en-IN") },
    { label: "Typical wait (median)", value: total ? ageText(medianHours) : "—" },
  ];
  const right = "text-right";
  return (
    <>
      <PageHeader title="Workload" description="Approvals and work tasks waiting on each person right now, how long they have waited, and what is overdue. Ages count calendar time. To move someone's approvals, open their name and use Hand over pending approvals; it suggests the people with the fewest waiting.">
        <Link href="/admin/workload/reassign" className="btn-secondary btn-compact">
          Move pending tasks
        </Link>
      </PageHeader>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="card p-5">
            <p className="text-label text-ink-muted">{tile.label}</p>
            <p className={`mt-2 text-display font-bold tabular-nums ${tile.alert ? "text-danger-600" : ""}`}>{tile.value}</p>
          </div>
        ))}
      </div>
      <ListToolbar id="workload-view" path={PATH} label="Workload view" keep={{}} filterCount={0} clearHref={null} group={groupMenu(PATH, query, GROUPS, group)} />
      <ListViews userId={user.id} target="list_admin_workload" path={PATH} query={query} />
      <section className="card overflow-x-auto">
        <h2 className="border-b border-line px-5 py-4 font-semibold">By person</h2>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing is waiting on anyone" />
          </div>
        ) : (
          <FoldScope enabled={Boolean(group)}>
            <table className="data-table">
              <SortHead
                path={PATH}
                query={query}
                sort={sort}
                columns={[
                  { key: "name", label: "Person" },
                  { key: "department", label: "Department" },
                  { key: "pending", label: "Waiting", className: right },
                  { key: "overdue", label: "Overdue", className: right },
                  ...AGE_BANDS.map((band) => ({ key: `band_${band.key}`, label: band.label, className: right })),
                  { key: "median", label: "Median wait", className: right },
                  { key: "oldest", label: "Oldest", className: right },
                ]}
              />
              <GroupedRows
                rows={rows}
                groups={groups}
                colSpan={COLUMNS.length}
                paged={false}
                render={(row) => (
                  <tr key={row.approverId}>
                    <td>
                      <Link href={`/admin/users/${row.approverId}`} className="link">
                        {row.name}
                      </Link>
                      {row.onHold > 0 && <span className="block text-caption text-ink-muted">{row.onHold} on hold</span>}
                    </td>
                    <td className="text-label">{row.department ?? <span className="text-ink-faint">—</span>}</td>
                    <td className="text-right tabular-nums">{row.pending}</td>
                    <td className={`text-right tabular-nums ${row.overdue ? "font-semibold text-danger-600" : ""}`}>{row.overdue}</td>
                    {AGE_BANDS.map((band) => (
                      <td key={band.key} className="text-right tabular-nums">
                        {row.bands[band.key] || "—"}
                      </td>
                    ))}
                    <td className="text-right tabular-nums">{ageText(row.medianHours)}</td>
                    <td className="text-right tabular-nums">{ageText(row.oldestHours)}</td>
                  </tr>
                )}
              />
            </table>
          </FoldScope>
        )}
      </section>
    </>
  );
}
