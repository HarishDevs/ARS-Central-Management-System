import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState } from "@/features/ui/Display";
import { ticketsPage } from "@/server/tickets/page-context";
import { statusCountRows } from "@/server/tickets/rules";
import { listTicketCategories, ticketCounts } from "@/lib/db/repositories/tickets.repository";

export const metadata: Metadata = { title: "Ticket dashboards" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §10): one dashboard per category (IT
// Software, IT Hardware, Admin…). Coordinators see their forms' tickets; IT sees all.
// v1.90.0 (D-427, owner: "display all status count"): each card also lists
// the count of every ticket status (zeros too, in the lifecycle's order), each
// opening the category's dashboard filtered to that status. The counts come
// from the same server-side visibility as before (ticketCounts with the
// viewer's categories), so nobody sees counts of tickets they can't see.
export default async function Page() {
  const { user, isAdmin, viewerCategoryIds, categoryIds } = await ticketsPage();
  // v1.55.3 (D-331, owner): coordinators (and IT) only; anyone else gets "not found".
  // v1.57.1 (D-338): only the categories this person coordinates (or was named for); IT sees all.
  if (!isAdmin && !categoryIds?.length) notFound();
  const categories = (await listTicketCategories(true)).filter((category) => isAdmin || categoryIds!.includes(category.id));
  const counts = await Promise.all(categories.map((category) => ticketCounts({ scope: "all", categoryId: category.id, status: null, q: "", page: 1 }, { id: user.id, isAdmin, categoryIds: viewerCategoryIds })));
  return (
    <>
      <PageHeader title="Ticket dashboards" icon={LayoutDashboard} description={isAdmin ? "Every category's tickets." : "The tickets of the forms you coordinate."} />
      {categories.length === 0 ? (
        <EmptyState title="No ticket categories yet" body="IT adds them in Admin → Set-up → Ticket categories." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="ticket-dashboards">
          {categories.map((category, index) => {
            const count = counts[index]!;
            const open = count.total - count.CLOSED;
            const base = `/users/tickets/dashboards/${category.id}`;
            return (
              <li key={category.id} className="card flex h-full flex-col px-5 py-4" data-testid="ticket-dashboard-card">
                <Link href={base} className="group block rounded-md hover:text-primary-700">
                  <p className="font-semibold group-hover:underline">
                    {category.name}
                  </p>
                  <p className="mt-1 text-stat font-semibold tabular-nums">{open.toLocaleString("en-IN")}</p>
                  <p className="text-label text-ink-muted">
                    open · {count.NEW + count.REOPENED} to assign · {count.overdue} overdue
                  </p>
                </Link>
                <ul className="mt-3 divide-y divide-line border-t border-line" aria-label={`${category.name} tickets by status`} data-testid="ticket-status-counts">
                  {statusCountRows(count).map((row) => (
                    <li key={row.status} className="py-1">
                      <Link href={`${base}?status=${row.filter}`} className="flex min-h-9 items-center justify-between gap-3 rounded px-1 text-label hover:bg-surface-muted" data-status={row.status}>
                        <span>{row.label}</span>
                        <span className={`font-semibold tabular-nums ${row.count ? "" : "text-ink-muted"}`}>{row.count.toLocaleString("en-IN")}</span>
                      </Link>
                      {row.note && (
                        <Link href={`${base}?status=${row.note.filter}`} className="link block px-1 text-caption">
                          {row.note.text}
                        </Link>
                      )}
                    </li>
                  ))}
                  <li className="py-1">
                    <Link href={`${base}?status=overdue`} className="flex min-h-9 items-center justify-between gap-3 rounded px-1 text-label hover:bg-surface-muted" data-status="overdue">
                      <span>Overdue</span>
                      <span className={`font-semibold tabular-nums ${count.overdue ? "text-danger-600" : "text-ink-muted"}`}>{count.overdue.toLocaleString("en-IN")}</span>
                    </Link>
                  </li>
                </ul>
                <p className="mt-2 text-caption text-ink-muted">{count.total.toLocaleString("en-IN")} tickets in all</p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
