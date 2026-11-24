import type { Metadata } from "next";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { listTicketCategories, listTicketViewers } from "@/lib/db/repositories/tickets.repository";
import { TicketCategoryForm } from "@/features/tickets/TicketCategoryForm";
import { TicketViewersForm } from "@/features/tickets/TicketViewersForm";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { listPeopleFacts } from "@/lib/db/repositories/tasks.repository";
import { personLabel } from "@/lib/people/label";

export const metadata: Metadata = { title: "Ticket categories" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §11): IT Software, IT Hardware, Admin… Each
// category numbers its own tickets (prefix-year-number) and has its own dashboard;
// its forms (request types) are set up in Ticket forms.
export default async function Page() {
  await requireArea("admin");
  const [categories, viewers, departments, people] = await Promise.all([listTicketCategories(), listTicketViewers(), listDepartments(), listPeopleFacts()]);
  return (
    <>
      <PageHeader title="Ticket categories" description="Each category numbers its own tickets (e.g. IT-SW-2026-00001) and has its own dashboard. Its request types are the ticket forms that choose it, in Ticket forms." />
      {/* v1.89.0 (D-423): a single-column settings form keeps the form width (960), not the full page. */}
      <div className="max-w-form">
      <section className="card mb-6 space-y-5 px-5 py-4" aria-label="Categories">
        {categories.map((category) => (
          <TicketCategoryForm key={category.id} category={category} />
        ))}
      </section>
      <section className="card mb-6 px-5 py-4" aria-labelledby="ticket-viewers-title">
        <h2 id="ticket-viewers-title" className="font-semibold">
          Who else sees tickets
        </h2>
        <p className="mb-3 text-label text-ink-muted">
          IT Admins and the Super Admin always do. The departments and people chosen here (for example the IT department) also see the tickets of the categories ticked below on the Ticket dashboards, the Coordinator board and Ticket analytics, and can open those tickets. They can read and add remarks; assigning stays with each form&apos;s coordinators. Everyone else sees only the categories of the forms they coordinate.
        </p>
        <TicketViewersForm
          departments={departments.filter((department) => department.active).map((department) => ({ id: department.id, label: department.name }))}
          people={people.filter((person) => person.active).map((person) => ({ id: person.id, label: personLabel(person) }))}
          categories={categories.filter((category) => category.active).map((category) => ({ id: category.id, name: category.name }))}
          departmentIds={viewers.departmentIds}
          userIds={viewers.userIds}
          categoryIds={viewers.categoryIds}
        />
      </section>
      <section className="card px-5 py-4" aria-labelledby="new-category">
        <h2 id="new-category" className="mb-3 font-semibold">
          New category
        </h2>
        <TicketCategoryForm />
      </section>
      </div>
    </>
  );
}
