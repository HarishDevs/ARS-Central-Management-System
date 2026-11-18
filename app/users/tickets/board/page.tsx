import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Columns3 } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState } from "@/features/ui/Display";
import { TicketPriorityBadge } from "@/features/tickets/TicketParts";
import { ticketsPage } from "@/server/tickets/page-context";
import { listTicketCategories, ticketBoard, type TicketBoardItem } from "@/lib/db/repositories/tickets.repository";
import { TICKET_STATUS_LABEL, isOverdue, type TicketStatus } from "@/server/tickets/rules";

export const metadata: Metadata = { title: "Coordinator board" };
export const dynamic = "force-dynamic";

// v1.56.0 (D-332, owner: "one more separate page for Coordinators that will
// show the status wise so that the coordinators can know where the ticket is
// now"). v1.57.1 (D-337, owner: "want this in a table format"): one table,
// grouped by status in the order a ticket moves, with a count chip per status
// that filters it. Each row says who has the ticket, since when, and the dates
// that matter at that stage. Closed shows the last 7 days. Coordinators see
// their forms' tickets; IT (and the people named in Admin) see all.
const STATUSES: { status: TicketStatus; hint: string }[] = [
  { status: "NEW", hint: "Waiting for a coordinator to assign" },
  { status: "REOPENED", hint: "The requester reopened it: reassign or let the assignee carry on" },
  { status: "ASSIGNED", hint: "Assigned; work not started yet" },
  { status: "IN_PROGRESS", hint: "The assignee is working on it" },
  { status: "AWAITING_CONFIRMATION", hint: "Work done; waiting for the requester to confirm" },
  { status: "CLOSED", hint: "Closed in the last 7 days" },
];
const ACCENT: Record<TicketStatus, string> = {
  NEW: "border-l-primary-600",
  REOPENED: "border-l-danger-600",
  ASSIGNED: "border-l-info-600",
  IN_PROGRESS: "border-l-warning-600",
  AWAITING_CONFIRMATION: "border-l-line-strong",
  CLOSED: "border-l-success-600",
};
const COLUMN_COUNT = 10;

const dayText = (value: Date) => value.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
const isoDayText = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
function ago(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-label ${on ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line text-ink-muted hover:text-ink"}`;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, isAdmin, viewerCategoryIds, categoryIds } = await ticketsPage();
  // v1.57.1 (D-338): only the categories this person coordinates (or was named for); IT sees all.
  if (!isAdmin && !categoryIds?.length) notFound();
  const query = await searchParams;
  const categories = (await listTicketCategories(true)).filter((category) => isAdmin || categoryIds!.includes(category.id));
  const categoryId = categories.some((category) => String(category.id) === query.category) ? Number(query.category) : null;
  const q = (query.q ?? "").trim().slice(0, 100);
  const overdueOnly = query.overdue === "1";
  const statusFilter = STATUSES.some((item) => item.status === query.status) ? (query.status as TicketStatus) : null;
  const items = await ticketBoard({ categoryId, q, overdueOnly }, { id: user.id, isAdmin, categoryIds: viewerCategoryIds });
  const now = new Date();
  const byStatus = new Map<TicketStatus, TicketBoardItem[]>();
  for (const item of items) byStatus.set(item.status, [...(byStatus.get(item.status) ?? []), item]);
  const overdueCount = items.filter((item) => isOverdue(item, now)).length;
  const filtered = Boolean(categoryId || q || overdueOnly);
  const hrefWith = (status: TicketStatus | null) => {
    const params = new URLSearchParams();
    if (categoryId) params.set("category", String(categoryId));
    if (q) params.set("q", q);
    if (overdueOnly) params.set("overdue", "1");
    if (status) params.set("status", status);
    const text = params.toString();
    return `/users/tickets/board${text ? `?${text}` : ""}`;
  };
  const shown = STATUSES.filter((item) => !statusFilter || item.status === statusFilter);

  return (
    <>
      <PageHeader
        title="Coordinator board"
        icon={Columns3}
        description={isAdmin ? "Where every ticket is now, by status." : "Where the tickets of the forms you coordinate are now, by status."}
      />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3" aria-label="Filter the board">
        <div>
          <label htmlFor="board-category" className="field-label">
            Category
          </label>
          <select id="board-category" name="category" defaultValue={categoryId ?? ""} className="field-input h-9 py-0">
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="board-q" className="field-label">
            Search
          </label>
          <input id="board-q" name="q" defaultValue={q} maxLength={100} placeholder="Ticket number or subject" className="field-input h-9" />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-label">
          <input type="checkbox" name="overdue" value="1" defaultChecked={overdueOnly} /> Only overdue
        </label>
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        <button type="submit" className="btn-secondary btn-compact">
          Apply
        </button>
        {(filtered || statusFilter) && (
          <Link href="/users/tickets/board" className="link text-label">
            Clear
          </Link>
        )}
        <p className="ml-auto text-label text-ink-muted" data-testid="board-summary">
          {items.filter((item) => item.status !== "CLOSED").length} open · <span className={overdueCount ? "font-semibold text-danger-600" : ""}>{overdueCount} overdue</span>
        </p>
      </form>

      <nav aria-label="Status" className="mb-3 flex flex-wrap gap-2" data-testid="board-status-chips">
        <Link href={hrefWith(null)} aria-current={!statusFilter ? "page" : undefined} className={chip(!statusFilter)}>
          All ({items.length})
        </Link>
        {STATUSES.map(({ status }) => (
          <Link key={status} href={hrefWith(status)} aria-current={statusFilter === status ? "page" : undefined} className={chip(statusFilter === status)}>
            {TICKET_STATUS_LABEL[status]} ({(byStatus.get(status) ?? []).length})
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState title={filtered ? "No tickets match" : "No tickets yet"} body={filtered ? "Change or clear the filters." : "Tickets of the forms you coordinate show here as soon as they are raised."} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table" data-testid="ticket-board">
            <caption className="sr-only">Tickets by status</caption>
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Subject</th>
                <th scope="col">Requestor</th>
                <th scope="col">Department</th>
                <th scope="col">Priority</th>
                <th scope="col">Assigned to</th>
                <th scope="col">In this status</th>
                <th scope="col">Target date</th>
                <th scope="col">Needed by</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            {shown.map(({ status, hint }) => {
              const rows = byStatus.get(status) ?? [];
              const label = TICKET_STATUS_LABEL[status];
              return (
                <tbody key={status} aria-label={`${label}: ${rows.length}`} data-testid={`board-column-${status}`}>
                  <tr className="bg-surface-muted">
                    <th scope="colgroup" colSpan={COLUMN_COUNT} className={`border-l-4 text-left ${ACCENT[status]}`}>
                      <span className="font-semibold">{label}</span> <span className="rounded-full bg-surface px-2 text-caption tabular-nums">{rows.length}</span>
                      <span className="ml-2 text-caption font-normal text-ink-muted">{hint}</span>
                    </th>
                  </tr>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMN_COUNT} className="text-caption text-ink-muted">
                        None
                      </td>
                    </tr>
                  ) : (
                    rows.map((item) => {
                      const overdue = isOverdue(item, now);
                      return (
                        <tr key={item.id} data-testid="board-card">
                          <td className="whitespace-nowrap font-mono text-label">
                            <Link href={`/users/tickets/${item.id}`} className="link">
                              {item.ticketNo}
                            </Link>
                          </td>
                          <td>
                            <Link href={`/users/tickets/${item.id}`} className="link font-medium">
                              {item.title}
                            </Link>
                            <p className="text-caption text-ink-muted">
                              {item.categoryName} · {item.typeName}
                            </p>
                          </td>
                          <td className="text-label">{item.requesterName}</td>
                          <td className="text-label">{item.departmentName ?? "—"}</td>
                          <td>
                            <TicketPriorityBadge priority={item.priority} />
                          </td>
                          <td className="text-label">
                            {item.assigneeName ?? <span className="text-ink-muted">Not assigned</span>}
                            {item.taskNo && <span className="block font-mono text-caption text-ink-muted">{item.taskNo}</span>}
                          </td>
                          <td className="whitespace-nowrap text-label">{status === "CLOSED" ? `${item.closeKind === "AUTO" ? "Auto closed" : "Closed"} ${dayText(item.statusSince)}` : ago(item.statusSince, now)}</td>
                          <td className={`whitespace-nowrap text-label ${overdue ? "font-semibold text-danger-600" : ""}`}>
                            {item.dueAt ? dayText(item.dueAt) : "—"}
                            {overdue && <span className="block text-caption">Overdue</span>}
                          </td>
                          <td className="whitespace-nowrap text-label">{item.requiredOn ? isoDayText(item.requiredOn) : "—"}</td>
                          <td className="text-caption text-ink-muted">
                            {status === "AWAITING_CONFIRMATION" && item.confirmDueOn && <span className="block">Auto-closes after {isoDayText(item.confirmDueOn)}</span>}
                            {item.reopenCount > 0 && <span className="block text-danger-600">Reopened {item.reopenCount}×</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </>
  );
}
