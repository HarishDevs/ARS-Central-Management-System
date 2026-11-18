import type { Metadata } from "next";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { listTicketCategories } from "@/lib/db/repositories/tickets.repository";
import { TicketCategoryForm } from "@/features/tickets/TicketCategoryForm";

export const metadata: Metadata = { title: "Ticket categories" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §11): IT Software, IT Hardware, Admin… Each
// category numbers its own tickets (prefix-year-number) and has its own dashboard;
// its forms (request types) are set up in Ticket forms.
export default async function Page() {
  await requireArea("admin");
  const categories = await listTicketCategories();
  return (
    <>
      <PageHeader title="Ticket categories" description="Each category numbers its own tickets (e.g. IT-SW-2026-00001) and has its own dashboard. Its request types are the ticket forms that choose it, in Ticket forms." />
      <section className="card mb-6 space-y-5 px-5 py-4" aria-label="Categories">
        {categories.map((category) => (
          <TicketCategoryForm key={category.id} category={category} />
        ))}
      </section>
      <section className="card px-5 py-4" aria-labelledby="new-category">
        <h2 id="new-category" className="mb-3 font-semibold">
          New category
        </h2>
        <TicketCategoryForm />
      </section>
    </>
  );
}
