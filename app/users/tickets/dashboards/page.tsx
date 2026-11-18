import type { Metadata } from "next";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState } from "@/features/ui/Display";
import { ticketsPage } from "@/server/tickets/page-context";
import { coordinatesAny, listTicketCategories, ticketCounts } from "@/lib/db/repositories/tickets.repository";

export const metadata: Metadata = { title: "Ticket dashboards" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §10): one dashboard per category (IT
// Software, IT Hardware, Admin…). Coordinators see their forms' tickets; IT sees all.
export default async function Page() {
  const { user, isAdmin } = await ticketsPage();
  const may = isAdmin || (await coordinatesAny(user.id));
  const categories = may ? await listTicketCategories(true) : [];
  const counts = await Promise.all(categories.map((category) => ticketCounts({ scope: "all", categoryId: category.id, status: null, q: "", page: 1 }, { id: user.id, isAdmin })));
  return (
    <>
      <PageHeader title="Ticket dashboards" icon={LayoutDashboard} description={isAdmin ? "Every category's tickets." : "The tickets of the forms you coordinate."} />
      {!may ? (
        <EmptyState title="Nothing to coordinate" body="Ticket dashboards are for the coordinators of ticket forms and IT. Your own tickets are in My tickets." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="ticket-dashboards">
          {categories.map((category, index) => {
            const count = counts[index]!;
            const open = count.total - count.CLOSED;
            return (
              <li key={category.id}>
                <Link href={`/users/tickets/dashboards/${category.id}`} className="card block h-full px-5 py-4 hover:border-line-strong">
                  <p className="font-semibold">{category.name}</p>
                  <p className="mt-1 text-title font-semibold tabular-nums">{open.toLocaleString("en-IN")}</p>
                  <p className="text-label text-ink-muted">
                    open · {count.NEW + count.REOPENED} to assign · {count.overdue} overdue
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
