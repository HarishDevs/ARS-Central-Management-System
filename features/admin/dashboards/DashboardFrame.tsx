import Link from "next/link";
import { PendingLink } from "@/features/ui/PendingLink";
import { PageHeader } from "@/features/shell/PageHeader";
import { Hint } from "@/features/ui/Hint";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { CUSTOM_TYPE, filterQuery, financialYearStart, presets, type DashboardFilter } from "@/server/dashboards/filters";
import { ListViews } from "@/features/lists/ListViews";
import { FoldScope } from "@/features/ui/GroupFold";
import { SortLink } from "@/features/ui/SortTh";
import { GroupedRows } from "@/features/admin/GroupedRows";
import { nextDir, parseColumnSort, sortHref, sortRows } from "@/server/lists/sorting";
import { groupRows } from "@/server/lists/group-rows";
import { groupMenu, keepListState, type GroupChoice } from "@/server/admin/lists";

// Shared frame of the four admin dashboards (S11-12, F-74): tabs, one filter
// bar (GET, so every view is a link that can be shared), period presets and
// the CSV download of what is on screen.
export const DASHBOARDS = [
  { slug: "utilisation", label: "Utilisation", title: "Approval utilisation", description: "How much each approval type is used, and how it ends." },
  { slug: "departments", label: "Department-wise raised", title: "Requests raised by department", description: "What each department raises, and how those requests end." },
  { slug: "approvers", label: "Approver-wise", title: "Approvers", description: "What each approver was given in the period, what they decided, and how fast." },
  { slug: "raisers", label: "Raiser-wise by department", title: "Raisers by department", description: "Who raises requests, grouped by their department." },
] as const;
export type DashboardSlug = (typeof DASHBOARDS)[number]["slug"];

export function DashboardFrame({
  slug,
  filter,
  today,
  choices,
  departmentNote,
  children,
  query,
  userId,
  groups,
}: {
  slug: DashboardSlug;
  filter: DashboardFilter;
  today: string;
  choices: { types: { id: number; name: string }[]; departments: { id: number; name: string }[] };
  departmentNote: string;
  children: React.ReactNode;
  // v1.58.0 (D-354, owner): the address (sort and group kept by the filters
  // and the quick periods), saved views (list_admin_dash_<slug>), Group by choices.
  query?: Record<string, string | undefined>;
  userId?: number;
  groups?: readonly GroupChoice[];
}) {
  const current = DASHBOARDS.find((item) => item.slug === slug)!;
  const filterText = filterQuery(filter);
  // Filters in use: a period other than this financial year to date, a type, a department.
  const filterCount = [filter.from !== financialYearStart(today) || filter.to !== today, filter.workflowId !== null, filter.departmentId !== null].filter(Boolean).length;
  const keep = keepListState(query ?? {});
  const listState = Object.entries(keep)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `&${key}=${encodeURIComponent(value)}`)
    .join("");
  const path = `/admin/dashboards/${slug}`;
  const group = groups?.find((choice) => choice.key === keep.group)?.key ?? null;
  return (
    <>
      <PageHeader title={current.title} description={current.description}>
        <a href={`/api/admin/dashboards/${slug}?${filterText}`} className="btn-secondary btn-compact" download>
          Download CSV
        </a>
      </PageHeader>
      <nav aria-label="Dashboards" className="mb-4 flex flex-wrap gap-2">
        {DASHBOARDS.map((item) => (
          <Link
            key={item.slug}
            href={`/admin/dashboards/${item.slug}?${filterText}`}
            aria-current={item.slug === slug ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-label font-semibold transition-colors ${
              item.slug === slug ? "border-primary-solid bg-primary-solid text-on-solid" : "border-line bg-surface text-ink hover:bg-surface-muted"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {/* v1.51.1 (owner): toolbar filters instead of a filter form. */}
      <ListToolbar
        id="dashboard-filters"
        path={`/admin/dashboards/${slug}`}
        label="Filters"
        keep={keep}
        group={groups?.length ? groupMenu(path, query ?? {}, groups, group) : undefined}
        filterCount={filterCount}
        clearHref={filterCount ? `/admin/dashboards/${slug}` : null}
        filters={
          <>
            <div>
              <label htmlFor="from" className="field-label">
                From
              </label>
              <input id="from" name="from" type="date" defaultValue={filter.from} max={today} className="field-input field-compact" />
            </div>
            <div>
              <label htmlFor="to" className="field-label">
                To
              </label>
              <input id="to" name="to" type="date" defaultValue={filter.to} max={today} className="field-input field-compact" />
            </div>
            <div>
              <label htmlFor="type" className="field-label">
                Approval type
              </label>
              <select id="type" name="type" defaultValue={filter.workflowId ?? ""} className="field-input field-compact">
                <option value="">All types</option>
                {choices.types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
                <option value={CUSTOM_TYPE}>Custom approvals</option>
              </select>
            </div>
            <div>
              <label htmlFor="dept" className="field-label">
                Department
              </label>
              <select id="dept" name="dept" defaultValue={filter.departmentId ?? ""} className="field-input field-compact">
                <option value="">All departments</option>
                {choices.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        }
      />
      <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
        <span>Quick:</span>
        {/* Plain links with a pending spinner: the last click always wins (QA DEF-04). */}
        {presets(today).map((preset) => (
          <PendingLink key={preset.label} className="link font-normal" href={`/admin/dashboards/${slug}?${filterQuery({ ...filter, from: preset.from, to: preset.to })}${listState}`}>
            {preset.label}
          </PendingLink>
        ))}
        <Hint text={`${departmentNote} Deleted requests are never counted.`} align="end" />
      </p>
      {userId !== undefined && query && <ListViews userId={userId} target={`list_admin_dash_${slug}`} path={path} query={query} />}
      {children}
    </>
  );
}

export function KpiTiles({ tiles }: { tiles: { label: string; value: string; note?: string }[] }) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="card px-4 py-3">
          <p className="text-label text-ink-muted">{tile.label}</p>
          <p className="mt-1 text-card-title font-bold tabular-nums">{tile.value}</p>
          {tile.note && <p className="text-caption text-ink-muted">{tile.note}</p>}
        </div>
      ))}
    </div>
  );
}

// How requests ended, as one thin stacked bar. The numbers are in the
// table's columns as well, so the colours are never the only carrier.
const SEGMENTS = [
  { key: "approved", label: "Approved", className: "bg-success-600" },
  { key: "rejected", label: "Rejected", className: "bg-danger-600" },
  { key: "open", label: "Open", className: "bg-warning-600" },
  { key: "withdrawn", label: "Withdrawn", className: "bg-ink-faint" },
] as const;

export function OutcomeLegend() {
  return (
    <p className="flex flex-wrap gap-4 border-b border-line px-5 py-3 text-caption text-ink-muted" aria-hidden="true">
      {SEGMENTS.map((segment) => (
        <span key={segment.key} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${segment.className}`} />
          {segment.label}
        </span>
      ))}
    </p>
  );
}

export function OutcomeBar({ approved, rejected, open, withdrawn }: { approved: number; rejected: number; open: number; withdrawn: number }) {
  const total = approved + rejected + open + withdrawn;
  const values = { approved, rejected, open, withdrawn };
  if (total === 0) return <span className="text-caption text-ink-faint">Not used</span>;
  return (
    <div
      role="img"
      aria-label={`${approved} approved, ${rejected} rejected, ${open} open, ${withdrawn} withdrawn`}
      title={`${approved} approved · ${rejected} rejected · ${open} open · ${withdrawn} withdrawn`}
      className="flex h-2.5 w-32 gap-px overflow-hidden rounded-full bg-surface-muted"
    >
      {SEGMENTS.map((segment) =>
        values[segment.key] > 0 ? <span key={segment.key} className={segment.className} style={{ width: `${(values[segment.key] / total) * 100}%` }} /> : null,
      )}
    </div>
  );
}

// A single-measure bar next to a number (e.g. requests raised).
export function MeasureBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-10 text-right tabular-nums">{value.toLocaleString("en-IN")}</span>
      <span aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-surface-muted">
        <span className="block h-full rounded-full bg-primary-600" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </span>
    </span>
  );
}

// A column's `hint` explains it on hover (D-179).
// v1.58.0 (D-354, owner): with `path`, `query` and `values` (the sortable value
// of each cell, row by row) every column sorts both ways; `groupOf` gives a
// row's group when the address has a Group by (folded at first).
export function DashboardTable({
  title,
  empty,
  head,
  rows,
  legend,
  path,
  query,
  values,
  groupOf,
}: {
  title?: string;
  empty: string;
  head: { label: string; numeric?: boolean; hint?: string; key?: string }[];
  rows: React.ReactNode[][];
  legend?: boolean;
  path?: string;
  query?: Record<string, unknown>;
  values?: unknown[][];
  groupOf?: ((index: number) => [string, number]) | null;
}) {
  const keys = head.map((cell, index) => cell.key ?? `c${index}`);
  const sorting = Boolean(path && query && values);
  const sort = parseColumnSort(query ?? {}, keys);
  const column = sorting && sort.sortBy ? keys.indexOf(sort.sortBy) : -1;
  const order = rows.map((_, index) => index);
  const sorted = column >= 0 ? sortRows(order, (index) => values?.[index]?.[column], sort.dir) : order;
  const groups = groupOf ? groupRows(sorted, groupOf) : null;
  const renderRow = (rowIndex: number) => (
    <tr key={rowIndex}>
      {rows[rowIndex]!.map((cell, index) => (
        <td key={index} className={head[index]?.numeric ? "text-right tabular-nums" : index === 0 ? "min-w-48" : undefined}>
          {cell}
        </td>
      ))}
    </tr>
  );
  return (
    <section className="card overflow-x-auto">
      {title && <h2 className="border-b border-line px-5 py-4 font-semibold">{title}</h2>}
      {legend && rows.length > 0 && <OutcomeLegend />}
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-label text-ink-muted">{empty}</p>
      ) : (
        <FoldScope enabled={Boolean(groups)}>
        <table className="data-table">
          {sorting ? (
            <thead>
              <tr>
                {head.map((cell, index) => {
                  const key = keys[index]!;
                  const active = sort.sortBy === key;
                  return (
                    <th key={key} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} data-sort-column={key} className={cell.numeric ? "text-right" : undefined}>
                      <SortLink label={cell.label} active={active} dir={sort.dir} href={sortHref(path!, query!, key, nextDir(sort, key))} />
                      {cell.hint && <Hint text={cell.hint} align={cell.numeric ? "end" : "start"} className="ml-0.5" />}
                    </th>
                  );
                })}
              </tr>
            </thead>
          ) : (
            <thead>
              <tr>
                {head.map((cell) => (
                  <th key={cell.label} className={cell.numeric ? "text-right" : undefined}>
                    {cell.label}
                    {cell.hint && <Hint text={cell.hint} align={cell.numeric ? "end" : "start"} className="ml-0.5" />}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <GroupedRows rows={sorted} groups={groups} colSpan={head.length} paged={false} render={renderRow} />
        </table>
        </FoldScope>
      )}
    </section>
  );
}
