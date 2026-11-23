import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { TicketPlus } from "lucide-react";
import { PageHeader } from "@/features/shell/PageHeader";
import { EmptyState, Breadcrumbs } from "@/features/ui/Display";
import { RaiseTicketForm } from "@/features/tickets/TicketForms";
import { ticketsPage } from "@/server/tickets/page-context";
import { listRaisableForms, coordinatorsOf } from "@/lib/db/repositories/tickets.repository";
import { findLiveType } from "@/lib/db/repositories/module-types.repository";
import { listPeopleFacts } from "@/lib/db/repositories/tasks.repository";
import { loadFieldLookups } from "@/lib/db/repositories/lookups.repository";
import { mayCreate, parseTicketSettings } from "@/server/modules/settings";
import { personLabel } from "@/lib/people/label";

export const metadata: Metadata = { title: "Raise a ticket" };
export const dynamic = "force-dynamic";

// v1.55.0 (owner's ticketing brief §3): choose the ticket type (a form of a
// category), then fill it in. Your name, ID, department and email come from
// your user details. Forms are set up by IT in Admin → Ticket forms.
export default async function Page({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { user } = await ticketsPage();
  const { type: typeParam } = await searchParams;
  const [forms, people] = await Promise.all([listRaisableForms(), listPeopleFacts()]);
  const me = people.find((person) => person.id === user.id);
  const allowed = me ? forms : [];
  const typeId = typeParam && /^\d{1,10}$/.test(typeParam) ? Number(typeParam) : null;
  const chosen = typeId ? allowed.find((form) => form.typeId === typeId) : undefined;

  if (!chosen) {
    const byCategory = new Map<string, typeof allowed>();
    for (const form of allowed) byCategory.set(form.categoryName, [...(byCategory.get(form.categoryName) ?? []), form]);
    return (
      <>
        <PageHeader title="Raise a ticket" icon={TicketPlus} description="Choose what you need help with. The ticket goes to that form's coordinators, who assign it to someone." />
        {allowed.length === 0 ? (
          <EmptyState title="No ticket forms yet" body="IT hasn't published any ticket forms. Please check back later." />
        ) : (
          <div className="space-y-6" data-testid="ticket-types">
            {[...byCategory].map(([category, list]) => (
              <section key={category} aria-labelledby={`cat-${category}`}>
                <h2 id={`cat-${category}`} className="mb-2 font-semibold">
                  {category}
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((form) => (
                    <li key={form.typeId}>
                      <Link href={`/users/tickets/new?type=${form.typeId}`} className="card block h-full px-4 py-3 hover:border-line-strong">
                        <p className="font-medium">{form.name}</p>
                        {form.description && <p className="text-label text-ink-muted">{form.description}</p>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </>
    );
  }

  const [type, lookups, coordinators] = await Promise.all([findLiveType("TICKET", chosen.typeId), loadFieldLookups(), coordinatorsOf(chosen.typeId)]);
  const settings = type ? parseTicketSettings(type.settings) : null;
  const may = type && settings && me && mayCreate(settings.access, { id: user.id, departmentId: me.departmentId });
  return (
    <>
      <Breadcrumbs items={[{ href: "/users/tickets/new", label: "Raise a ticket" }, { label: chosen.name }]} />
      <PageHeader title={chosen.name} icon={TicketPlus} description={chosen.description ?? `A ${chosen.categoryName} ticket.`} />
      {!type || !settings || !may ? (
        <EmptyState title="You can't raise this kind of ticket" body="Ask IT if you think you should." />
      ) : coordinators.length === 0 ? (
        <EmptyState title="This form has no coordinator yet" body="Nobody would receive the ticket. Ask IT to add a coordinator in Admin → Set-up → Ticket forms." />
      ) : (
        <RaiseTicketForm
          typeId={chosen.typeId}
          typeName={chosen.name}
          categoryName={chosen.categoryName}
          form={type.form}
          people={people.map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }))}
          lookups={lookups}
          me={{ name: user.name, loginId: me?.loginId ?? "", department: me?.departmentName ?? null, email: user.email }}
          priorityChoice={settings.requesterPriority}
          defaultPriority={settings.defaultPriority}
          submissionKey={randomUUID()}
          today={new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)}
        />
      )}
    </>
  );
}
