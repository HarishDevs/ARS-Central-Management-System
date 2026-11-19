import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState, NoResults } from "@/features/ui/Display";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { PersonSelect } from "@/features/ui/PersonSelect";
import { personLabel } from "@/lib/people/label";
import { requireArea } from "@/server/authorization/guards";
import { canExport } from "@/server/settings/features";
import { listRecords, recordChoices, RECORDS_EXPORT_MAX, RECORDS_PAGE_SIZE } from "@/lib/db/repositories/records.repository";
import { INFO_PRIORITIES, INFO_STATUSES, readRecordFilter, RECORD_GROUPS, recordQuery, REQUEST_STATUSES, TASK_PRIORITIES, TASK_STATUSES, type RecordFilter, type RecordKind } from "@/server/records/filters";
import { ListViews } from "@/features/lists/ListViews";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortLink as ColumnSortLink } from "@/features/ui/SortTh";
import { applyDefaultListView } from "@/server/lists/views";
import { departmentBucket, groupRows } from "@/server/lists/group-rows";
import { monthBucket } from "@/server/admin/lists";
import { rolesSeeConfidential } from "@/server/approvals/confidential";
import { ChoicePill } from "@/features/ui/ChoicePill";
import { columnsFor, PRIORITY_LABEL, RECORD_HREF, RECORD_TITLE, STATUS_LABEL, type RecordColumn } from "@/server/records/columns";

// D-191 (owner): Admin → Records. Every approval request, task and
// information item, whoever raised it, in a spreadsheet-like table with
// filters, sorting and a CSV download (opens in Excel). IT Admin and Super
// Admin only (the Admin area); read-only.
const BASE: Record<RecordKind, string> = { requests: "/admin/records/requests", tasks: "/admin/records/tasks", information: "/admin/records/information" };
const PERSON_LABEL: Record<RecordKind, string> = { requests: "Raised by", tasks: "Assignee", information: "Created by" };
const DATE_LABEL: Record<RecordKind, string> = { requests: "Submitted", tasks: "Created", information: "Created" };

// v1.58.0 (D-354, owner): every column sorts both ways (except Amount and a
// request's Priority: read from each form, possibly confidential); Group by
// Department, Status, Type, Month (and Priority for tasks and information),
// folded at first; saved views (list_admin_records_<kind>).
type AnyRecord = { id: number; department: string | null; status: string; type: string; priority?: unknown; submitted?: Date; created?: Date };
function recordBucket(kind: RecordKind, group: string, row: AnyRecord): [string, number] {
  if (group === "department") return departmentBucket(row.department);
  if (group === "status") {
    const order: readonly string[] = kind === "requests" ? REQUEST_STATUSES : kind === "tasks" ? TASK_STATUSES : INFO_STATUSES;
    return [kind === "tasks" && row.status === "CANCELLED" ? "Cancelled" : (STATUS_LABEL[row.status] ?? row.status), order.indexOf(row.status)];
  }
  if (group === "type") return [row.type, 0];
  if (group === "priority") {
    const priority = String(row.priority ?? "");
    const order: readonly string[] = kind === "tasks" ? TASK_PRIORITIES : [...INFO_PRIORITIES].reverse();
    return [PRIORITY_LABEL[priority] ?? priority, order.indexOf(priority)];
  }
  return monthBucket(kind === "requests" ? row.submitted : row.created);
}

export async function RecordsRegister({ kind, searchParams }: { kind: RecordKind; searchParams: Record<string, string | undefined> }) {
  const { user } = await requireArea("admin");
  await applyDefaultListView(user.id, `list_admin_records_${kind}`, BASE[kind], searchParams);
  const filter = readRecordFilter(kind, searchParams);
  const [result, choices, mayExport] = await Promise.all([listRecords(kind, filter), recordChoices(kind), canExport(user)]);
  const people = choices.people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }));
  // PB-34: confidential amounts by the viewer's rule (QA-SEC-01).
  const columns = columnsFor(kind, { seeConfidential: rolesSeeConfidential(user.roles) }) as RecordColumn<(typeof result.rows)[number]>[];
  const statuses = kind === "requests" ? REQUEST_STATUSES : kind === "tasks" ? TASK_STATUSES : INFO_STATUSES;
  const priorities = kind === "tasks" ? TASK_PRIORITIES : kind === "information" ? INFO_PRIORITIES : [];
  const base = BASE[kind];
  const shown = result.rows.length;
  const firstRow = shown ? (result.page - 1) * RECORDS_PAGE_SIZE + 1 : 0;
  const groupChoices = RECORD_GROUPS[kind];
  const groups = filter.group ? groupRows(result.rows as AnyRecord[], (row) => recordBucket(kind, filter.group!, row)) : null;
  const position = new Map(result.rows.map((row, index) => [row.id, index]));
  const filtered = Boolean(filter.q || filter.status || filter.type || filter.department || filter.person || filter.waitingOn || filter.priority || filter.overdue || filter.from || filter.to);

  const renderRow = (row: (typeof result.rows)[number]) => (
    <tr key={row.id} className="odd:bg-surface even:bg-page hover:bg-primary-50/60">
      <td className="sticky left-0 border-b border-r border-line bg-inherit px-2 py-1.5 text-right tabular-nums text-ink-faint">{firstRow + (position.get(row.id) ?? 0)}</td>
      {columns.map((column) => (
        <td key={column.key} className={`border-b border-r border-line px-3 py-1.5 align-top ${column.wide ? "min-w-[14rem] max-w-[22rem]" : "whitespace-nowrap"}`}>
          {column.key === "no" ? (
            <Link href={RECORD_HREF[kind](row.id)} className="link font-medium">
              {column.value(row)}
            </Link>
          ) : column.key === "overdue" && column.value(row) ? (
            <span className="font-medium text-danger-600">{column.value(row)}</span>
          ) : column.color && column.value(row) ? (
            <ChoicePill label={column.value(row)} color={column.color(row)} className="text-caption" />
          ) : (
            column.value(row)
          )}
        </td>
      ))}
    </tr>
  );

  return (
    <>
      <PageHeader
        title={RECORD_TITLE[kind]}
        description={`Every ${RECORD_TITLE[kind].toLowerCase()} record in the app, whoever raised it. Click a column title to sort; the download has every matching row (up to ${RECORDS_EXPORT_MAX.toLocaleString("en-IN")}) and opens in Excel.`}
        meta={`${result.total.toLocaleString("en-IN")} ${result.total === 1 ? "record" : "records"}${filtered ? " match the filters" : ""}`}
      >
        {mayExport && (
          <a href={`/api/admin/records/${kind}${recordQuery(filter, { page: null })}`} className="btn-secondary btn-compact" download>
            <Download aria-hidden="true" className="h-4 w-4" /> Download CSV
          </a>
        )}
      </PageHeader>

      <nav aria-label="Records" className="mb-4 flex flex-wrap gap-2" data-testid="records-tabs">
        {(Object.keys(BASE) as RecordKind[]).map((tab) => (
          <Link
            key={tab}
            href={BASE[tab]}
            aria-current={tab === kind ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-label ${tab === kind ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted hover:bg-surface-muted"}`}
          >
            {RECORD_TITLE[tab]}
          </Link>
        ))}
      </nav>

      {/* D-228: the same toolbar as every list (Filter, Sort, Search). */}
      <ListToolbar
        id="records-filters"
        path={base}
        label="Filter records"
        keep={{ sort: filter.sort !== "no" ? filter.sort : undefined, dir: filter.dir !== "desc" ? filter.dir : undefined, group: filter.group ?? undefined }}
        group={{
          label: groupChoices.find((choice) => choice.key === filter.group)?.label ?? null,
          clearHref: `${base}${recordQuery(filter, { group: null, page: null })}`,
          choices: [
            { label: "None", href: `${base}${recordQuery(filter, { group: null, page: null })}`, active: !filter.group },
            ...groupChoices.map((choice) => ({ label: choice.label, href: `${base}${recordQuery(filter, { group: choice.key, page: null })}`, active: filter.group === choice.key })),
          ],
        }}
        search={{ name: "q", value: filter.q, placeholder: "Number, title or person" }}
        filterCount={[filter.status, filter.type, filter.department, filter.person, filter.waitingOn, filter.priority, filter.overdue, filter.from || filter.to].filter(Boolean).length}
        clearHref={
          filtered
            ? `${base}${recordQuery({ ...filter, q: "", status: "", type: null, department: null, person: null, waitingOn: null, priority: "", overdue: false, from: null, to: null } as RecordFilter, { page: null })}`
            : null
        }
        filters={
          <>
            <Choice name="status" label="Status" value={filter.status} options={statuses.map((status) => [status, kind === "tasks" && status === "CANCELLED" ? "Cancelled" : (STATUS_LABEL[status] ?? status)])} />
            <Choice name="type" label="Type" value={filter.type ?? ""} options={choices.types.map((type) => [String(type.id), type.name])} />
            <Choice name="department" label="Department" value={filter.department ?? ""} options={choices.departments.map((department) => [String(department.id), department.name])} />
            <PersonChoice name="person" label={PERSON_LABEL[kind]} value={filter.person ?? null} options={people} />
            {kind === "requests" && <PersonChoice name="waiting" label="Waiting on" value={filter.waitingOn ?? null} options={people} />}
            {priorities.length > 0 && <Choice name="priority" label="Priority" value={filter.priority} options={priorities.map((priority) => [priority, PRIORITY_LABEL[priority] ?? priority])} />}
            <div>
              <label htmlFor="rfrom" className="field-label">
                {DATE_LABEL[kind]} from
              </label>
              <input id="rfrom" type="date" name="from" defaultValue={filter.from ?? ""} className="field-input h-10" />
            </div>
            <div>
              <label htmlFor="rto" className="field-label">
                {DATE_LABEL[kind]} to
              </label>
              <input id="rto" type="date" name="to" defaultValue={filter.to ?? ""} className="field-input h-10" />
            </div>
            {kind === "tasks" && (
              <label className="flex items-center gap-2 self-end pb-2.5 text-label">
                <input type="checkbox" name="overdue" value="1" defaultChecked={filter.overdue} className="h-4 w-4 accent-[var(--color-primary-solid)]" /> Overdue only
              </label>
            )}
          </>
        }
        sort={{
          label: columns.find((column) => column.sort === filter.sort)?.label ?? "Number",
          changed: filter.sort !== "no" || filter.dir !== "desc",
          clearHref: `${base}${recordQuery(filter, { sort: null, dir: null, page: null })}`,
          choices: columns
            .filter((column) => column.sort)
            .map((column) => ({ label: column.label, href: `${base}${recordQuery(filter, { sort: column.sort === "no" ? null : column.sort!, dir: null, page: null })}`, active: filter.sort === column.sort })),
        }}
      />

      <ListViews userId={user.id} target={`list_admin_records_${kind}`} path={base} query={searchParams} />

      {shown === 0 ? (
        filtered ? (
          <NoResults what="records" query={filter.q} clearSearchHref={`${base}${recordQuery(filter, { q: null, page: null })}`} resetHref={base} />
        ) : (
          <EmptyState title="No records" body={`No ${RECORD_TITLE[kind].toLowerCase()} yet.`} />
        )
      ) : (
        <FoldScope enabled={Boolean(groups)}>
        <div className="card overflow-hidden">
          <div className="max-h-[70vh] overflow-auto" data-testid="records-table">
            <table className="w-max min-w-full border-collapse text-label">
              <caption className="sr-only">{RECORD_TITLE[kind]}</caption>
              <thead className="sticky top-0 z-10 bg-surface-muted">
                <tr>
                  <th scope="col" className="sticky left-0 z-20 w-12 border-b border-r border-line bg-surface-muted px-2 py-2 text-right font-medium text-ink-faint">
                    #
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={column.sort && filter.sort === column.sort ? (filter.dir === "asc" ? "ascending" : "descending") : undefined}
                      className="whitespace-nowrap border-b border-r border-line px-3 py-2 text-left font-medium text-ink-muted"
                    >
                      {column.sort ? <SortLink filter={filter} base={base} column={column.sort} label={column.label} /> : column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {groups ? (
                groups.map((group) => (
                  <FoldTbody key={group.key} label={group.label} count={group.items.length} colSpan={columns.length + 1} testId="records-group">
                    {(group.items as typeof result.rows).map(renderRow)}
                  </FoldTbody>
                ))
              ) : (
                <tbody>{result.rows.map(renderRow)}</tbody>
              )}
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-label text-ink-muted">
            <span>
              Rows {firstRow.toLocaleString("en-IN")}–{(firstRow + shown - 1).toLocaleString("en-IN")} of {result.total.toLocaleString("en-IN")}
            </span>
            <span className="flex gap-2">
              {result.page > 1 && (
                <Link href={`${base}${recordQuery(filter, { page: result.page - 1 })}`} className="btn-secondary btn-compact" rel="prev">
                  Previous
                </Link>
              )}
              {result.page < result.pages && (
                <Link href={`${base}${recordQuery(filter, { page: result.page + 1 })}`} className="btn-secondary btn-compact" rel="next">
                  Next
                </Link>
              )}
            </span>
          </div>
        </div>
        </FoldScope>
      )}
    </>
  );
}

// v1.52.1: a person filter, typed to search ("Name - code", department below).
function PersonChoice({ name, label, value, options }: { name: string; label: string; value: number | null; options: { id: number; label: string; detail?: string }[] }) {
  return (
    <div>
      <label htmlFor={`r-${name}`} className="field-label">
        {label}
      </label>
      <PersonSelect id={`r-${name}`} name={name} options={options} defaultValue={value} emptyLabel="All" compact />
    </div>
  );
}

function Choice({ name, label, value, options }: { name: string; label: string; value: string | number; options: (readonly [string, string])[] }) {
  return (
    <div>
      <label htmlFor={`r-${name}`} className="field-label">
        {label}
      </label>
      <select id={`r-${name}`} name={name} defaultValue={String(value)} className="field-input h-10">
        <option value="">All</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

// v1.58.0 (D-354): the shared sort link (arrows and wording as every table).
// The active column flips its direction; another column starts ascending.
function SortLink({ filter, base, column, label }: { filter: RecordFilter; base: string; column: string; label: string }) {
  const active = filter.sort === column;
  const dir = active ? (filter.dir === "asc" ? "desc" : "asc") : "asc";
  return <ColumnSortLink label={label} active={active} dir={filter.dir} href={`${base}${recordQuery(filter, { sort: column === "no" ? null : column, dir: dir === "desc" ? null : dir, page: null })}`} />;
}
