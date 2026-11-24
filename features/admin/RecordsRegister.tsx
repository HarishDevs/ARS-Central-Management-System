import { Download } from "lucide-react";
import { EmptyState, NoResults } from "@/features/ui/Display";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { ListPage } from "@/features/ui/ListPage";
import { personLabel } from "@/lib/people/label";
import { requireArea } from "@/server/authorization/guards";
import { canExport } from "@/server/settings/features";
import { listRecords, recordChoices, RECORDS_EXPORT_MAX, RECORDS_PAGE_SIZE } from "@/lib/db/repositories/records.repository";
import { INFO_PRIORITIES, INFO_STATUSES, readRecordFilter, RECORD_GROUPS, recordQuery, REQUEST_STATUSES, TASK_PRIORITIES, TASK_STATUSES, type RecordFilter, type RecordKind } from "@/server/records/filters";
import { ListViews } from "@/features/lists/ListViews";
import { PowerSearch, type PowerField } from "@/features/ui/PowerSearch";
import { DataTable, type Row as TableRow } from "@/features/ui/DataTable";
import { RecordPane } from "@/features/ui/RecordPane";
import { DetailsList } from "@/features/ui/DetailsList";
import { RecordsTabs } from "@/features/admin/RecordsTabs";
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
// v1.85.0 (D-412): Records also has Tickets and Meetings (features/admin/TicketMeetingRecords.tsx), on the same shared table.
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
  const filtered = Boolean(filter.q || filter.status || filter.type || filter.department || filter.person || filter.waitingOn || filter.priority || filter.overdue || filter.from || filter.to);

  // v1.85.0 (D-412): the power search (chips in the address) instead of the Filter panel.
  const fields: PowerField[] = [
    { key: "q", label: "Number, title or person", input: "text", operators: [{ label: "contains", param: "q" }] },
    { key: "status", label: "Status", input: "choice", operators: [{ label: "is", param: "status" }], options: statuses.map((status) => [status, kind === "tasks" && status === "CANCELLED" ? "Cancelled" : (STATUS_LABEL[status] ?? status)] as const) },
    { key: "type", label: "Type", input: "choice", operators: [{ label: "is", param: "type" }], options: choices.types.map((type) => [String(type.id), type.name] as const) },
    { key: "department", label: "Department", input: "choice", operators: [{ label: "is", param: "department" }], options: choices.departments.map((department) => [String(department.id), department.name] as const) },
    { key: "person", label: PERSON_LABEL[kind], input: "choice", operators: [{ label: "is", param: "person" }], options: people.map((person) => [String(person.id), person.label] as const) },
    ...(kind === "requests" ? [{ key: "waiting", label: "Waiting on", input: "choice" as const, operators: [{ label: "is", param: "waiting" }], options: people.map((person) => [String(person.id), person.label] as const) }] : []),
    ...(priorities.length ? [{ key: "priority", label: "Priority", input: "choice" as const, operators: [{ label: "is", param: "priority" }], options: priorities.map((priority) => [priority, PRIORITY_LABEL[priority] ?? priority] as const) }] : []),
    { key: "date", label: DATE_LABEL[kind], input: "date", operators: [{ label: "on or after", param: "from" }, { label: "on or before", param: "to" }] },
    ...(kind === "tasks" ? [{ key: "overdue", label: "Overdue", input: "flag" as const, operators: [{ label: "is", param: "overdue" }] }] : []),
  ];
  const current = recordQuery(filter, {});
  const openHref = (id: number) => `${base}${current ? `${current}&` : "?"}open=${id}`;
  const openId = /^\d{1,10}$/.test(searchParams.open ?? "") ? Number(searchParams.open) : null;
  const openRow = openId === null ? null : (result.rows.find((row) => row.id === openId) ?? null);
  const tableRow = (row: (typeof result.rows)[number]): TableRow => ({
    id: row.id,
    href: openHref(row.id),
    fullHref: RECORD_HREF[kind](row.id),
    current: row.id === openId,
    cells: Object.fromEntries(columns.map((column) => [column.key,
      column.key === "overdue" && column.value(row) ? (
        <span key={column.key} className="font-medium text-danger-600">
          {column.value(row)}
        </span>
      ) : column.color && column.value(row) ? (
        <ChoicePill key={column.key} label={column.value(row)} color={column.color(row)} className="text-caption" />
      ) : (
        column.value(row)
      )]),
    ),
  });

  return (
    // v1.89.0 (D-423, UIQA-CON-01): the shared list page; the power search (chips, Add filter)
    // leads the shared toolbar row (one toolbar: filters, Sort, Group), not a row of its own.
    <ListPage
      title={RECORD_TITLE[kind]}
      description={`Every ${RECORD_TITLE[kind].toLowerCase()} record in the app, whoever raised it. Add filters as chips, click a column title to sort, click a row to open it beside the table; the download has every matching row (up to ${RECORDS_EXPORT_MAX.toLocaleString("en-IN")}) and opens in Excel.`}
      meta={`${result.total.toLocaleString("en-IN")} ${result.total === 1 ? "record" : "records"}${filtered ? " match the filters" : ""}`}
      action={
        mayExport ? (
          <a href={`/api/admin/records/${kind}${recordQuery(filter, { page: null })}`} className="btn-secondary btn-compact" download>
            <Download aria-hidden="true" className="h-4 w-4" /> Download CSV
          </a>
        ) : undefined
      }
      tabs={<RecordsTabs current={kind} user={user} />}
      toolbar={
      <ListToolbar
        lead={<PowerSearch inToolbar base={base} fields={fields} params={{ ...searchParams, sort: filter.sort !== "no" ? filter.sort : undefined, dir: filter.dir !== "desc" ? filter.dir : undefined, group: filter.group ?? undefined }} label="Filter records" />}
        id="records-filters"
        path={base}
        label="Sort and group records"
        keep={{ ...Object.fromEntries(Object.entries({ q: filter.q, status: filter.status, type: filter.type ? String(filter.type) : "", department: filter.department ? String(filter.department) : "", person: filter.person ? String(filter.person) : "", waiting: filter.waitingOn ? String(filter.waitingOn) : "", priority: filter.priority, overdue: filter.overdue ? "1" : "", from: filter.from ?? "", to: filter.to ?? "" }).filter(([, value]) => value)), sort: filter.sort !== "no" ? filter.sort : undefined, dir: filter.dir !== "desc" ? filter.dir : undefined, group: filter.group ?? undefined }}
        group={{
          label: groupChoices.find((choice) => choice.key === filter.group)?.label ?? null,
          clearHref: `${base}${recordQuery(filter, { group: null, page: null })}`,
          choices: [
            { label: "None", href: `${base}${recordQuery(filter, { group: null, page: null })}`, active: !filter.group },
            ...groupChoices.map((choice) => ({ label: choice.label, href: `${base}${recordQuery(filter, { group: choice.key, page: null })}`, active: filter.group === choice.key })),
          ],
        }}
        filterCount={0}
        clearHref={null}
        sort={{
          label: columns.find((column) => column.sort === filter.sort)?.label ?? "Number",
          changed: filter.sort !== "no" || filter.dir !== "desc",
          clearHref: `${base}${recordQuery(filter, { sort: null, dir: null, page: null })}`,
          choices: columns
            .filter((column) => column.sort)
            .map((column) => ({ label: column.label, href: `${base}${recordQuery(filter, { sort: column.sort === "no" ? null : column.sort!, dir: null, page: null })}`, active: filter.sort === column.sort })),
        }}
      />
      }
    >

      <ListViews userId={user.id} target={`list_admin_records_${kind}`} path={base} query={searchParams} />

      {shown === 0 ? (
        filtered ? (
          <NoResults what="records" query={filter.q} clearSearchHref={`${base}${recordQuery(filter, { q: null, page: null })}`} resetHref={base} />
        ) : (
          <EmptyState title="No records" body={`No ${RECORD_TITLE[kind].toLowerCase()} yet.`} />
        )
      ) : (
        <DataTable
          look="records"
          caption={RECORD_TITLE[kind]}
          storageKey={`admin-records-${kind}`}
          empty={{ title: "No records" }}
          columns={columns.map((column) => ({ key: column.key, header: column.label, wide: column.wide }))}
          serverSort={{ sortBy: columns.find((column) => column.sort === filter.sort)?.key ?? null, dir: filter.dir, hrefs: Object.fromEntries(columns.filter((column) => column.sort).map((column) => [column.key, sortOf(filter, base, column.sort!).href])) }}
          rows={result.rows.map(tableRow)}
          groups={groups ? groups.map((group) => ({ key: group.key, label: group.label, ids: (group.items as typeof result.rows).map((row) => row.id) })) : null}
          pager={{ firstRow, total: result.total, prevHref: result.page > 1 ? `${base}${recordQuery(filter, { page: result.page - 1 })}` : null, nextHref: result.page < result.pages ? `${base}${recordQuery(filter, { page: result.page + 1 })}` : null }}
        />
      )}

      {openId !== null && (
        <RecordPane title={openRow ? `${columns[0]!.value(openRow)}: ${String((openRow as { title?: string }).title ?? "")}` : "Record"} closeHref={`${base}${current}`} fullHref={RECORD_HREF[kind](openId)}>
          {openRow ? (
            <DetailsList testId="record-details" items={columns.map((column, index) => ({ label: column.label, value: index === 0 ? column.value(openRow) : column.color && column.value(openRow) ? <ChoicePill label={column.value(openRow)} color={column.color(openRow)} className="text-caption" /> : column.value(openRow), wide: column.wide }))} />
          ) : (
            <p className="text-label text-ink-muted">This record isn&apos;t on this page of the list (or no longer matches the filters). Open its full page to see it.</p>
          )}
        </RecordPane>
      )}
    </ListPage>
  );
}

// v1.58.0 (D-354): the active column flips its direction; another column starts ascending.
function sortOf(filter: RecordFilter, base: string, column: string) {
  const active = filter.sort === column;
  const dir = active ? (filter.dir === "asc" ? "desc" : "asc") : "asc";
  return { active, dir: filter.dir, href: `${base}${recordQuery(filter, { sort: column === "no" ? null : column, dir: dir === "desc" ? null : dir, page: null })}` };
}
