import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Columns3 } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState } from "@/features/ui/Display";
import { TicketPriorityBadge } from "@/features/tickets/TicketParts";
import { ticketsPage } from "@/server/tickets/page-context";
import { coordinatesAny, listTicketCategories, ticketBoard, type TicketBoardItem } from "@/lib/db/repositories/tickets.repository";
import { TICKET_STATUS_LABEL, isOverdue, type TicketStatus } from "@/server/tickets/rules";

export const metadata: Metadata = { title: "Coordinator board" };
export const dynamic = "force-dynamic";

// v1.56.0 (D-332, owner: "one more separate page for Coordinators that will
// show the status wise so that the coordinators can know where the ticket is
// now"). One column per status, in the order a ticket moves; each card says
// who has it, since when, and the dates that matter at that stage. Closed
// shows the last 7 days. Coordinators see their forms' tickets; IT sees all.
const COLUMNS: { status: TicketStatus; hint: string }[] = [
  { status: "NEW", hint: "Waiting for a coordinator to assign" },
  { status: "REOPENED", hint: "The requester reopened it: reassign or let the assignee carry on" },
  { status: "ASSIGNED", hint: "Assigned; work not started yet" },
  { status: "IN_PROGRESS", hint: "The assignee is working on it" },
  { status: "AWAITING_CONFIRMATION", hint: "Work done; waiting for the requester to confirm" },
  { status: "CLOSED", hint: "Closed in the last 7 days" },
];
const ACCENT: Record<TicketStatus, string> = {
  NEW: "border-t-primary-600",
  REOPENED: "border-t-danger-600",
  ASSIGNED: "border-t-info-600",
  IN_PROGRESS: "border-t-warning-600",
  AWAITING_CONFIRMATION: "border-t-line-strong",
  CLOSED: "border-t-success-600",
};

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

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, isAdmin } = await ticketsPage();
  if (!isAdmin && !(await coordinatesAny(user.id))) notFound();
  const query = await searchParams;
  const categories = await listTicketCategories(true);
  const categoryId = categories.some((category) => String(category.id) === query.category) ? Number(query.category) : null;
  const q = (query.q ?? "").trim().slice(0, 100);
  const overdueOnly = query.overdue === "1";
  const items = await ticketBoard({ categoryId, q, overdueOnly }, { id: user.id, isAdmin });
  const now = new Date();
  const byStatus = new Map<TicketStatus, TicketBoardItem[]>();
  for (const item of items) byStatus.set(item.status, [...(byStatus.get(item.status) ?? []), item]);
  const overdueCount = items.filter((item) => isOverdue(item, now)).length;
  const filtered = Boolean(categoryId || q || overdueOnly);

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
        <button type="submit" className="btn-secondary btn-compact">
          Apply
        </button>
        {filtered && (
          <Link href="/users/tickets/board" className="link text-label">
            Clear
          </Link>
        )}
        <p className="ml-auto text-label text-ink-muted" data-testid="board-summary">
          {items.filter((item) => item.status !== "CLOSED").length} open · <span className={overdueCount ? "font-semibold text-danger-600" : ""}>{overdueCount} overdue</span>
        </p>
      </form>

      {items.length === 0 ? (
        <EmptyState title={filtered ? "No tickets match" : "No tickets yet"} body={filtered ? "Change or clear the filters." : "Tickets of the forms you coordinate show here as soon as they are raised."} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" data-testid="ticket-board">
          {COLUMNS.map(({ status, hint }) => {
            const cards = byStatus.get(status) ?? [];
            const label = TICKET_STATUS_LABEL[status];
            return (
              <section key={status} aria-label={`${label}: ${cards.length}`} className={`card min-w-0 border-t-4 ${ACCENT[status]}`} data-testid={`board-column-${status}`}>
                <header className="border-b border-line px-3 py-2">
                  <h2 className="flex items-center justify-between gap-2 text-label font-semibold">
                    {label}
                    <span className="rounded-full bg-surface-muted px-2 text-caption tabular-nums">{cards.length}</span>
                  </h2>
                  <p className="text-caption text-ink-muted">{hint}</p>
                </header>
                {cards.length === 0 ? (
                  <p className="px-3 py-4 text-caption text-ink-muted">None</p>
                ) : (
                  <ul className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
                    {cards.map((item) => {
                      const overdue = isOverdue(item, now);
                      return (
                        <li key={item.id}>
                          <Link href={`/users/tickets/${item.id}`} className={`block rounded-md border px-3 py-2 hover:border-line-strong ${overdue ? "border-danger-600" : "border-line"}`} data-testid="board-card">
                            <span className="flex items-start justify-between gap-2">
                              <span className="font-mono text-caption text-ink-muted">{item.ticketNo}</span>
                              <TicketPriorityBadge priority={item.priority} />
                            </span>
                            <span className="mt-1 block text-label font-medium">{item.title}</span>
                            <span className="mt-1 block text-caption text-ink-muted">
                              {item.requesterName}
                              {item.departmentName ? ` · ${item.departmentName}` : ""}
                            </span>
                            <span className="block text-caption text-ink-muted">{item.typeName}</span>
                            <span className="mt-1 block text-caption">
                              {item.assigneeName ? (
                                <>
                                  With <span className="font-medium">{item.assigneeName}</span>
                                  {item.taskNo ? ` (${item.taskNo})` : ""}
                                </>
                              ) : (
                                <span className="text-ink-muted">Not assigned</span>
                              )}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-x-2 text-caption text-ink-muted">
                              <span>
                                {status === "CLOSED" ? (item.closeKind === "AUTO" ? "Auto closed" : "Closed") : "In this status"} {status === "CLOSED" ? dayText(item.statusSince) : `for ${ago(item.statusSince, now)}`}
                              </span>
                              {item.dueAt && status !== "CLOSED" && status !== "AWAITING_CONFIRMATION" && <span className={overdue ? "font-semibold text-danger-600" : ""}>{overdue ? "Overdue · " : ""}Target {dayText(item.dueAt)}</span>}
                              {item.requiredOn && status !== "CLOSED" && <span>Needed by {isoDayText(item.requiredOn)}</span>}
                              {status === "AWAITING_CONFIRMATION" && item.confirmDueOn && <span>Auto-closes after {isoDayText(item.confirmDueOn)}</span>}
                              {item.reopenCount > 0 && <span className="text-danger-600">Reopened {item.reopenCount}×</span>}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
