import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { Breadcrumbs, EmptyState } from "@/features/ui/Display";
import { TICKET_GROUP_LABEL, TICKET_GROUPS, TicketTable } from "@/features/tickets/TicketParts";
import { pickGroup } from "@/server/lists/group-rows";
import { ListViews } from "@/features/lists/ListViews";
import { applyDefaultListView } from "@/server/lists/views";
import { parseColumnSort } from "@/server/lists/sorting";
import { ticketsPage } from "@/server/tickets/page-context";
import { findTicketCategory, listTickets, ticketCounts, TICKET_PAGE_SIZE, TICKET_SORT_COLUMNS, type TicketListFilter } from "@/lib/db/repositories/tickets.repository";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { listPeopleFacts } from "@/lib/db/repositories/tasks.repository";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, type TicketPriority } from "@/server/modules/settings";
import { TICKET_STATUSES, TICKET_STATUS_LABEL } from "@/server/tickets/rules";

export const metadata: Metadata = { title: "Ticket dashboard" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §10): a category's dashboard. The numbers
// come from the ticket records with the same filters as the table; every
// number opens the table filtered to it. Coordinators see their forms'
// tickets; IT sees all.
const STATUS_FILTERS = ["open", "overdue", ...TICKET_STATUSES, "auto"] as const;
const STATUS_FILTER_LABEL: Record<string, string> = { open: "All open", overdue: "Overdue", auto: "Closed – auto closed", ...TICKET_STATUS_LABEL };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, isAdmin, viewerCategoryIds, categoryIds } = await ticketsPage();
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const category = await findTicketCategory(Number(id));
  // v1.57.1 (D-338): a category this person coordinates (or was named for); IT sees all.
  if (!category || !(isAdmin || categoryIds?.includes(category.id))) notFound();
  const query = await searchParams;
  // v1.58.0 (D-354, owner: saved views, private): one view list per category
  // dashboard (target list_ticket_dashboard_<id>, on its own address).
  const base = `/users/tickets/dashboards/${category.id}`;
  const viewTarget = `list_ticket_dashboard_${category.id}`;
  await applyDefaultListView(user.id, viewTarget, base, query);
  // v1.58.0 (D-354, owner: sorting on every column, both directions): ?sortBy=&dir= (SQL, the list is paged).
  const sort = parseColumnSort(query, TICKET_SORT_COLUMNS);
  const status = (STATUS_FILTERS as readonly string[]).includes(query.status ?? "") ? (query.status as TicketListFilter["status"]) : null;
  const filter: TicketListFilter = {
    scope: "all",
    categoryId: category.id,
    status,
    q: (query.q ?? "").trim().slice(0, 100),
    page: Math.max(1, Math.min(1000, Number(query.page) || 1)),
    from: ISO.test(query.from ?? "") ? query.from! : null,
    to: ISO.test(query.to ?? "") ? query.to! : null,
    departmentId: /^\d{1,10}$/.test(query.dept ?? "") ? Number(query.dept) : null,
    priority: (TICKET_PRIORITIES as readonly string[]).includes(query.priority ?? "") ? (query.priority as TicketPriority) : null,
    assigneeId: /^\d{1,10}$/.test(query.assignee ?? "") ? Number(query.assignee) : null,
    sort,
  };
  const viewer = { id: user.id, isAdmin, categoryIds: viewerCategoryIds };
  const [counts, list, departments, people] = await Promise.all([ticketCounts(filter, viewer), listTickets(filter, viewer), listDepartments(), listPeopleFacts()]);
  // v1.57.5 (D-344): Group by, kept with the filters.
  const group = pickGroup(query.group, TICKET_GROUPS);
  const keep = { from: filter.from, to: filter.to, dept: filter.departmentId, priority: filter.priority, assignee: filter.assigneeId, status: filter.status, group };
  // v1.58.0 (D-354): the sort stays on through filters, tiles and pages; Clear drops it too.
  const sortKeep: Record<string, string> = sort.sortBy ? { sortBy: sort.sortBy, dir: sort.dir } : {};
  const filterQuery = Object.fromEntries(Object.entries(keep).filter(([, value]) => value !== null && value !== undefined && value !== "").map(([key, value]) => [key, String(value)]));
  const href = (change: Record<string, string | number | null>) => {
    const next = Object.entries({ ...keep, ...sortKeep, ...change }).filter(([, value]) => value !== null && value !== undefined && value !== "");
    return `${base}${next.length ? `?${new URLSearchParams(next.map(([key, value]) => [key, String(value)])).toString()}` : ""}`;
  };
  const tiles = [
    { label: "Total tickets", value: counts.total, status: null },
    { label: "New", value: counts.NEW + counts.REOPENED, status: "NEW", note: counts.REOPENED ? `incl. ${counts.REOPENED} reopened` : undefined },
    { label: "Assigned", value: counts.ASSIGNED, status: "ASSIGNED" },
    { label: "In progress", value: counts.IN_PROGRESS, status: "IN_PROGRESS" },
    { label: "Awaiting confirmation", value: counts.AWAITING_CONFIRMATION, status: "AWAITING_CONFIRMATION" },
    { label: "Closed", value: counts.CLOSED, status: "CLOSED", note: counts.AUTO ? `${counts.AUTO} auto closed` : undefined },
    { label: "Overdue", value: counts.overdue, status: "overdue", tone: "text-danger-600" },
  ];
  const pages = Math.max(1, Math.ceil(list.total / TICKET_PAGE_SIZE));
  const select = "field-input h-9 py-0 text-label";
  return (
    <>
      <Breadcrumbs items={[{ href: "/users/tickets/dashboards", label: "Ticket dashboards" }, { label: category.name }]} />
      <PageHeader title={`${category.name} tickets`} icon={LayoutDashboard} description={isAdmin ? "Every ticket of this category." : "The tickets of the forms you coordinate in this category."} />
      <ul className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" aria-label="Totals" data-testid="ticket-kpis">
        {tiles.map((tile) => (
          <li key={tile.label}>
            <Link href={href({ status: tile.status, page: null })} aria-current={filter.status === tile.status ? "true" : undefined} className={`card block h-full px-4 py-3 hover:border-line-strong ${filter.status === tile.status && tile.status ? "border-primary-600" : ""}`}>
              <p className="text-label text-ink-muted">{tile.label}</p>
              <p className={`text-title font-semibold tabular-nums ${tile.tone ?? ""}`}>{tile.value.toLocaleString("en-IN")}</p>
              {tile.note && <p className="text-caption text-ink-muted">{tile.note}</p>}
            </Link>
          </li>
        ))}
      </ul>
      <form method="get" action={base} className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3" aria-label="Ticket filters">
        <div>
          <label htmlFor="tf-from" className="field-label">
            Raised from
          </label>
          <input id="tf-from" name="from" type="date" defaultValue={filter.from ?? ""} className={select} />
        </div>
        <div>
          <label htmlFor="tf-to" className="field-label">
            to
          </label>
          <input id="tf-to" name="to" type="date" defaultValue={filter.to ?? ""} className={select} />
        </div>
        <div>
          <label htmlFor="tf-dept" className="field-label">
            Department
          </label>
          <select id="tf-dept" name="dept" defaultValue={filter.departmentId ?? ""} className={select}>
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tf-priority" className="field-label">
            Priority
          </label>
          <select id="tf-priority" name="priority" defaultValue={filter.priority ?? ""} className={select}>
            <option value="">All priorities</option>
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {TICKET_PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tf-status" className="field-label">
            Status
          </label>
          <select id="tf-status" name="status" defaultValue={filter.status ?? ""} className={select}>
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>
                {STATUS_FILTER_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tf-assignee" className="field-label">
            Assigned employee
          </label>
          <select id="tf-assignee" name="assignee" defaultValue={filter.assigneeId ?? ""} className={select}>
            <option value="">Anyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tf-group" className="field-label">
            Group by
          </label>
          <select id="tf-group" name="group" defaultValue={group ?? ""} className={select}>
            <option value="">None</option>
            {TICKET_GROUPS.map((value) => (
              <option key={value} value={value}>
                {TICKET_GROUP_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        {sort.sortBy && <input type="hidden" name="sortBy" value={sort.sortBy} />}
        {sort.sortBy && <input type="hidden" name="dir" value={sort.dir} />}
        <button type="submit" className="btn-primary btn-compact">
          Apply
        </button>
        {(Object.values(keep).some((value) => value !== null) || sort.sortBy) && (
          <Link href={base} className="link text-label">
            Clear
          </Link>
        )}
      </form>
      <p className="mb-2 text-label text-ink-muted" role="status">
        {list.total.toLocaleString("en-IN")} ticket{list.total === 1 ? "" : "s"}
        {filter.status ? ` · ${STATUS_FILTER_LABEL[filter.status] ?? filter.status}` : ""}
      </p>
      {/* v1.58.0 (D-354): saved views (private) of this dashboard: filters, group, sort. */}
      <ListViews userId={user.id} target={viewTarget} path={base} query={{ ...filterQuery, ...sortKeep }} />
      {list.items.length === 0 ? (
        <EmptyState title="No tickets match" body="Change or clear the filters." />
      ) : (
        <TicketTable items={list.items} caption={`${category.name} tickets`} group={group} sort={{ state: sort, path: base, query: filterQuery }} />
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-label">
          {filter.page > 1 ? <Link href={href({ page: filter.page - 1 })} className="link">← Previous</Link> : <span />}
          <span className="text-ink-muted">
            Page {filter.page} of {pages}
          </span>
          {filter.page < pages ? <Link href={href({ page: filter.page + 1 })} className="link">Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
