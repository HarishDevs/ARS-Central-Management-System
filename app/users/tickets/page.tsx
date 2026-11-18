import type { Metadata } from "next";
import Link from "next/link";
import { Ticket } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState } from "@/features/ui/Display";
import { TicketTable } from "@/features/tickets/TicketParts";
import { ticketsPage } from "@/server/tickets/page-context";
import { listTickets, TICKET_PAGE_SIZE } from "@/lib/db/repositories/tickets.repository";

export const metadata: Metadata = { title: "My tickets" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §12): the tickets I raised, and the ones
// assigned to me (the work itself is in my Tasks).
const VIEWS = { mine: "Raised by me", assigned: "Assigned to me" } as const;
const STATES = { open: "Open", closed: "Closed", all: "All" } as const;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, isAdmin } = await ticketsPage();
  const params = await searchParams;
  const view = params.view === "assigned" ? "assigned" : "mine";
  const state = params.state === "closed" || params.state === "all" ? params.state : "open";
  const page = Math.max(1, Math.min(1000, Number(params.page) || 1));
  const { items, total } = await listTickets({ scope: view, categoryId: null, status: state === "all" ? null : state, q: (params.q ?? "").trim().slice(0, 100), page }, { id: user.id, isAdmin });
  const pages = Math.max(1, Math.ceil(total / TICKET_PAGE_SIZE));
  const href = (change: Record<string, string | number>) => `/users/tickets?${new URLSearchParams({ view, state, ...Object.fromEntries(Object.entries(change).map(([key, value]) => [key, String(value)])) }).toString()}`;
  return (
    <>
      <PageHeader title="My tickets" icon={Ticket} description="Tickets you raised, and tickets assigned to you (work on them in your Tasks).">
        <Link href="/users/tickets/new" className="btn-primary btn-compact">
          Raise a ticket
        </Link>
      </PageHeader>
      <nav aria-label="Which tickets" className="mb-3 flex flex-wrap gap-x-1 border-b border-line">
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((key) => (
          <Link key={key} href={href({ view: key, page: 1 })} aria-current={view === key ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-2 text-label ${view === key ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}>
            {VIEWS[key]}
          </Link>
        ))}
      </nav>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Status">
        {(Object.keys(STATES) as (keyof typeof STATES)[]).map((key) => (
          <Link key={key} href={href({ state: key, page: 1 })} aria-current={state === key ? "page" : undefined} className={`rounded-full border px-3 py-1 text-label ${state === key ? "border-primary-600 bg-primary-50 text-primary-700" : "border-line text-ink-muted hover:bg-surface-muted"}`}>
            {STATES[key]}
          </Link>
        ))}
        <span className="text-label text-ink-muted" role="status">
          {total.toLocaleString("en-IN")} ticket{total === 1 ? "" : "s"}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No tickets here" body={view === "mine" ? "Tickets you raise appear here." : "Tickets assigned to you appear here."} />
      ) : (
        <TicketTable items={items} caption={VIEWS[view]} withTask={view === "assigned"} />
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-label">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="link">← Previous</Link> : <span />}
          <span className="text-ink-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="link">Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
