import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState } from "@/features/ui/Display";
import { ticketsPage } from "@/server/tickets/page-context";
import { listTicketCategories, ticketCounts } from "@/lib/db/repositories/tickets.repository";

export const metadata: Metadata = { title: "Ticket dashboards" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §10): one dashboard per category (IT
// Software, IT Hardware, Admin…). Coordinators see their forms' tickets; IT sees all.
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
