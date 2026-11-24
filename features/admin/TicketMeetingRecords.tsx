import { ListPage } from "@/features/ui/ListPage";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { EmptyState, NoResults } from "@/features/ui/Display";
import { ChoicePill } from "@/features/ui/ChoicePill";
import { DetailsList } from "@/features/ui/DetailsList";
import { PowerSearch, type PowerField } from "@/features/ui/PowerSearch";
import { powerHref } from "@/features/ui/power-href";
import { RecordPane } from "@/features/ui/RecordPane";
import { DataTable, type Row as TableRow } from "@/features/ui/DataTable";
import { RecordsTabs } from "@/features/admin/RecordsTabs";
import { requireArea } from "@/server/authorization/guards";
import { isAdminActor } from "@/server/modules/tasks";
import { listTicketCategories, listTickets, TICKET_PAGE_SIZE, TICKET_SORT_COLUMNS, type TicketListFilter, type TicketSortColumn } from "@/lib/db/repositories/tickets.repository";
import { listMeetings, listMeetingTypes } from "@/lib/db/repositories/meetings.repository";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { TICKET_STATUSES, TICKET_STATUS_LABEL, statusText, type TicketStatus } from "@/server/tickets/rules";
import { scopeFor } from "@/server/meetings/service";
import { MEETING_STATUSES, MODE_LABEL, PRIORITY_LABEL as MEETING_PRIORITY_LABEL, STATUS_LABEL as MEETING_STATUS_LABEL } from "@/server/meetings/rules";
import { MEETING_SORT_COLUMNS } from "@/server/meetings/list-sort";
import { parseColumnSort } from "@/server/lists/sorting";
import { PRIORITY_LABEL } from "@/server/records/columns";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { BUILT_IN_PRIORITY_COLOR } from "@/server/forms/option-colors";

// v1.85.0 (D-412, owner: Records also has Tickets and Meetings): every ticket
// and every meeting, read with the queries the users' pages already use and
// their permission checks: the ticket list's "all" scope with the IT viewer
// (isAdminActor: every ticket, as on the users' ticket pages for IT) and the
// meetings' scopeFor (IT and Management see every meeting). No new data
// access. The same shared table, power search and record pane as the other
// Records tabs. No CSV download here yet (the records download API covers
// requests, tasks and information).
type Query = Record<string, string | undefined>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const id = (value: string | undefined) => (value && /^\d{1,10}$/.test(value) ? Number(value) : null);
const TICKET_PRIORITIES = ["URGENT", "HIGH", "IMPORTANT", "ELEVATED", "NORMAL"] as const;
const TICKET_STATES: (readonly [string, string])[] = [["open", "Open"], ["overdue", "Overdue"], ["closed", "Closed"], ["auto", "Closed – auto closed"], ...TICKET_STATUSES.map((status) => [status, TICKET_STATUS_LABEL[status]] as const)];
const when = (value: Date | null | undefined) => (value ? formatIndiaTime(value) : "");

function sortHref(base: string, query: Query, column: string, active: boolean, dir: "asc" | "desc") {
  return powerHref(base, query, { sortBy: column, dir: active && dir === "asc" ? "desc" : "asc" });
}

// The same list on another page (powerHref drops page and open).
function pageHref(base: string, query: Query, n: number) {
  const href = powerHref(base, query, {});
  return n <= 1 ? href : `${href}${href.includes("?") ? "&" : "?"}page=${n}`;
}

// v1.89.0 (D-423, UIQA-CON-01): the shared list toolbar for Tickets and Meetings: the power
// search (chips, Add filter) leads the row, and Sort lists the same columns as the column
// titles, as on the other Records tabs.
function RecordsToolbar({ id: toolbarId, base, query, fields, label, columns, sort }: { id: string; base: string; query: Query; fields: PowerField[]; label: string; columns: { label: string; sort?: string }[]; sort: { sortBy: string | null; dir: "asc" | "desc" } }) {
  const sortable = columns.filter((column) => column.sort);
  return (
    <ListToolbar
      id={toolbarId}
      path={base}
      label={label}
      keep={{}}
      filterCount={0}
      clearHref={null}
      lead={<PowerSearch inToolbar base={base} fields={fields} params={query} label={label} />}
      sort={{
        label: sortable.find((column) => column.sort === sort.sortBy)?.label ?? "Newest first",
        changed: Boolean(sort.sortBy),
        clearHref: powerHref(base, query, { sortBy: null, dir: null }),
        choices: sortable.map((column) => ({ label: column.label, href: powerHref(base, query, { sortBy: column.sort!, dir: "asc" }), active: sort.sortBy === column.sort })),
      }}
    />
  );
}

function tableColumns(columns: { key: string; label: string; wide?: boolean }[]) {
  return columns.map((column) => ({ key: column.key, header: column.label, wide: column.wide }));
}

function serverSortOf(base: string, query: Query, columns: { key: string; sort?: string }[], sort: { sortBy: string | null; dir: "asc" | "desc" }) {
  return {
    sortBy: columns.find((column) => column.sort && column.sort === sort.sortBy)?.key ?? null,
    dir: sort.dir,
    hrefs: Object.fromEntries(columns.filter((column) => column.sort).map((column) => [column.key, sortHref(base, query, column.sort!, sort.sortBy === column.sort, sort.dir)])),
  };
}

function Pane({ base, query, title, fullHref, items }: { base: string; query: Query; title: string; fullHref: string; items: { label: string; value: React.ReactNode; wide?: boolean }[] | null }) {
  return (
    <RecordPane title={title} closeHref={powerHref(base, query, { open: null, page: query.page ?? null })} fullHref={fullHref}>
      {items ? <DetailsList testId="record-details" items={items} /> : <p className="text-label text-ink-muted">This record isn&apos;t on this page of the list (or no longer matches the filters). Open its full page to see it.</p>}
    </RecordPane>
  );
}

export async function TicketRecords({ query }: { query: Query }) {
  const { user } = await requireArea("admin");
  const base = "/admin/records/tickets";
  const page = Math.max(1, Math.min(100_000, Number(query.page) || 1));
  const sort = parseColumnSort(query, TICKET_SORT_COLUMNS);
  const state = TICKET_STATES.some(([value]) => value === query.status) ? (query.status as TicketListFilter["status"]) : null;
  const priority = (TICKET_PRIORITIES as readonly string[]).includes(query.priority ?? "") ? (query.priority as TicketListFilter["priority"]) : null;
  const filter: TicketListFilter = {
    scope: "all",
    categoryId: id(query.category),
    status: state,
    q: (query.q ?? "").trim().slice(0, 100),
    page,
    from: query.from && DAY.test(query.from) ? query.from : null,
    to: query.to && DAY.test(query.to) ? query.to : null,
    departmentId: id(query.department),
    priority,
    sort: sort.sortBy ? (sort as { sortBy: TicketSortColumn; dir: "asc" | "desc" }) : null,
  };
  const [{ items, total }, categories, departments] = await Promise.all([listTickets(filter, { id: user.id, isAdmin: isAdminActor(user) }), listTicketCategories(), listDepartments()]);
  const fields: PowerField[] = [
    { key: "q", label: "Number or subject", input: "text", operators: [{ label: "contains", param: "q" }] },
    { key: "status", label: "Status", input: "choice", operators: [{ label: "is", param: "status" }], options: TICKET_STATES },
    { key: "category", label: "Category", input: "choice", operators: [{ label: "is", param: "category" }], options: categories.map((category) => [String(category.id), category.name] as const) },
    { key: "department", label: "Department", input: "choice", operators: [{ label: "is", param: "department" }], options: departments.map((department) => [String(department.id), department.name] as const) },
    { key: "priority", label: "Priority", input: "choice", operators: [{ label: "is", param: "priority" }], options: TICKET_PRIORITIES.map((value) => [value, PRIORITY_LABEL[value] ?? value] as const) },
    { key: "raised", label: "Raised", input: "date", operators: [{ label: "on or after", param: "from" }, { label: "on or before", param: "to" }] },
  ];
  const filtered = Boolean(filter.q || filter.status || filter.categoryId || filter.departmentId || filter.priority || filter.from || filter.to);
  const columns: { key: string; label: string; sort?: TicketSortColumn; wide?: boolean; value: (item: (typeof items)[number]) => React.ReactNode }[] = [
    { key: "no", label: "Ticket no.", sort: "ticket", value: (item) => item.ticketNo },
    { key: "subject", label: "Subject", sort: "subject", wide: true, value: (item) => item.title },
    { key: "category", label: "Category", value: (item) => item.categoryName },
    { key: "form", label: "Form", value: (item) => item.typeName },
    { key: "requestor", label: "Requestor", sort: "requestor", value: (item) => item.requesterName },
    { key: "department", label: "Department", sort: "department", value: (item) => item.departmentName ?? "" },
    { key: "assignee", label: "Assignee", sort: "assignee", value: (item) => item.assigneeName ?? "" },
    { key: "priority", label: "Priority", sort: "priority", value: (item) => <ChoicePill label={PRIORITY_LABEL[item.priority] ?? item.priority} color={BUILT_IN_PRIORITY_COLOR[item.priority] ?? null} className="text-caption" /> },
    { key: "status", label: "Status", sort: "status", value: (item) => statusText(item.status as TicketStatus, item.closeKind) },
    { key: "raised", label: "Raised", sort: "created", value: (item) => when(item.submittedAt) },
    { key: "target", label: "Target", sort: "target", value: (item) => when(item.dueAt) },
  ];
  const openId = id(query.open);
  const openItem = openId === null ? null : (items.find((item) => item.id === openId) ?? null);
  const row = (item: (typeof items)[number]): TableRow => ({ id: item.id, href: powerHref(base, query, { open: String(item.id), page: page > 1 ? String(page) : null }), fullHref: `/users/tickets/${item.id}`, current: item.id === openId, cells: Object.fromEntries(columns.map((column) => [column.key, column.value(item)])) });
  const pages = Math.max(1, Math.ceil(total / TICKET_PAGE_SIZE));
  return (
    <ListPage
      title="Tickets"
      description="Every ticket in the app, whoever raised it. Add filters as chips, click a column title to sort, click a row to open it beside the table."
      meta={`${total.toLocaleString("en-IN")} ${total === 1 ? "ticket" : "tickets"}${filtered ? " match the filters" : ""}`}
      tabs={<RecordsTabs current="tickets" user={user} />}
      toolbar={<RecordsToolbar id="records-tickets" base={base} query={query} fields={fields} label="Filter tickets" columns={columns} sort={sort} />}
    >
      {items.length === 0 ? (
        filtered ? <NoResults what="tickets" query={filter.q} resetHref={base} /> : <EmptyState title="No tickets" body="No tickets yet." />
      ) : (
        <DataTable
          look="records"
          caption="Tickets"
          storageKey="admin-records-tickets"
          empty={{ title: "No tickets" }}
          columns={tableColumns(columns)}
          serverSort={serverSortOf(base, query, columns, sort)}
          rows={items.map(row)}
          pager={{ firstRow: (page - 1) * TICKET_PAGE_SIZE + 1, total, prevHref: page > 1 ? pageHref(base, query, page - 1) : null, nextHref: page < pages ? pageHref(base, query, page + 1) : null }}
        />
      )}
      {openId !== null && (
        <Pane
          base={base}
          query={query}
          title={openItem ? `${openItem.ticketNo}: ${openItem.title}` : "Ticket"}
          fullHref={`/users/tickets/${openId}`}
          items={openItem ? columns.map((column) => ({ label: column.label, value: column.value(openItem), wide: column.wide })).concat(openItem.taskNo ? [{ label: "Linked task", value: openItem.taskNo, wide: false }] : []) : null}
        />
      )}
    </ListPage>
  );
}

const MEETING_PAGE_SIZE = 25;
export async function MeetingRecords({ query }: { query: Query }) {
  const { user } = await requireArea("admin");
  const base = "/admin/records/meetings";
  const page = Math.max(1, Math.min(100_000, Number(query.page) || 1));
  const sort = parseColumnSort(query, MEETING_SORT_COLUMNS);
  const from = query.from && DAY.test(query.from) ? new Date(Date.parse(`${query.from}T00:00:00Z`) - 330 * 60_000) : null;
  const to = query.to && DAY.test(query.to) ? new Date(Date.parse(`${query.to}T00:00:00Z`) - 330 * 60_000 + 86_400_000) : null;
  const status = (MEETING_STATUSES as readonly string[]).includes(query.status ?? "") ? (query.status as string) : null;
  const filterQ = (query.q ?? "").trim().slice(0, 100);
  const [scope, types, departments] = await Promise.all([scopeFor(user), listMeetingTypes(true), listDepartments()]);
  const { rows, total } = await listMeetings(scope, { tab: "all", userId: user.id, q: filterQ, typeId: id(query.type), departmentId: id(query.department), status, from, to, page, pageSize: MEETING_PAGE_SIZE, sortBy: sort.sortBy, dir: sort.dir });
  const fields: PowerField[] = [
    { key: "q", label: "Number or title", input: "text", operators: [{ label: "contains", param: "q" }] },
    { key: "status", label: "Status", input: "choice", operators: [{ label: "is", param: "status" }], options: MEETING_STATUSES.map((value) => [value, MEETING_STATUS_LABEL[value]] as const) },
    { key: "type", label: "Type", input: "choice", operators: [{ label: "is", param: "type" }], options: types.map((type) => [String(type.id), type.name] as const) },
    { key: "department", label: "Department", input: "choice", operators: [{ label: "is", param: "department" }], options: departments.map((department) => [String(department.id), department.name] as const) },
    { key: "date", label: "Starts", input: "date", operators: [{ label: "on or after", param: "from" }, { label: "on or before", param: "to" }] },
  ];
  const filtered = Boolean(filterQ || status || query.type || query.department || from || to);
  type Row = (typeof rows)[number];
  const columns: { key: string; label: string; sort?: (typeof MEETING_SORT_COLUMNS)[number]; wide?: boolean; value: (row: Row) => React.ReactNode }[] = [
    { key: "no", label: "Meeting no.", sort: "no", value: (row) => row.meetingNo },
    { key: "title", label: "Title", sort: "title", wide: true, value: (row) => row.title },
    { key: "type", label: "Type", value: (row) => row.typeName },
    { key: "when", label: "Starts", sort: "when", value: (row) => when(row.scheduledStart) },
    { key: "mode", label: "Mode", sort: "mode", value: (row) => MODE_LABEL[row.mode] },
    { key: "owner", label: "Meeting owner", sort: "owner", value: (row) => row.ownerName },
    { key: "coordinator", label: "Coordinator", sort: "coordinator", value: (row) => row.coordinatorName },
    { key: "dept", label: "Department", sort: "dept", value: (row) => row.departmentName ?? "" },
    { key: "priority", label: "Priority", sort: "priority", value: (row) => MEETING_PRIORITY_LABEL[row.priority] ?? row.priority },
    { key: "invited", label: "Invited", sort: "invited", value: (row) => String(row.participants) },
    { key: "status", label: "Status", sort: "status", value: (row) => MEETING_STATUS_LABEL[row.status] },
    { key: "actions", label: "Open actions", value: (row) => String(row.openActions) },
  ];
  const openId = id(query.open);
  const openRow = openId === null ? null : (rows.find((row) => row.id === openId) ?? null);
  const tableRow = (row: Row): TableRow => ({ id: row.id, href: powerHref(base, query, { open: String(row.id), page: page > 1 ? String(page) : null }), fullHref: `/users/meetings/${row.id}`, current: row.id === openId, cells: Object.fromEntries(columns.map((column) => [column.key, column.value(row)])) });
  const pages = Math.max(1, Math.ceil(total / MEETING_PAGE_SIZE));
  return (
    <ListPage
      title="Meetings"
      description="Every meeting in the app, whoever runs it. Add filters as chips, click a column title to sort, click a row to open it beside the table."
      meta={`${total.toLocaleString("en-IN")} ${total === 1 ? "meeting" : "meetings"}${filtered ? " match the filters" : ""}`}
      tabs={<RecordsTabs current="meetings" user={user} />}
      toolbar={<RecordsToolbar id="records-meetings" base={base} query={query} fields={fields} label="Filter meetings" columns={columns} sort={sort} />}
    >
      {rows.length === 0 ? (
        filtered ? <NoResults what="meetings" query={filterQ} resetHref={base} /> : <EmptyState title="No meetings" body="No meetings yet." />
      ) : (
        <DataTable
          look="records"
          caption="Meetings"
          storageKey="admin-records-meetings"
          empty={{ title: "No meetings" }}
          columns={tableColumns(columns)}
          serverSort={serverSortOf(base, query, columns, sort)}
          rows={rows.map(tableRow)}
          pager={{ firstRow: (page - 1) * MEETING_PAGE_SIZE + 1, total, prevHref: page > 1 ? pageHref(base, query, page - 1) : null, nextHref: page < pages ? pageHref(base, query, page + 1) : null }}
        />
      )}
      {openId !== null && (
        <Pane base={base} query={query} title={openRow ? `${openRow.meetingNo}: ${openRow.title}` : "Meeting"} fullHref={`/users/meetings/${openId}`} items={openRow ? columns.map((column) => ({ label: column.label, value: column.value(openRow), wide: column.wide })) : null} />
      )}
    </ListPage>
  );
}
