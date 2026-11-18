"use client";

import { saveTicketFormSetupAction } from "@/app/admin/tickets/actions";
import { FieldError, ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";
import { PeoplePicker } from "@/features/ui/PeoplePicker";
import { Hint } from "@/features/ui/Hint";
import type { TicketFormSetupData } from "@/lib/db/repositories/tickets.repository";

// v1.55.0 (owner, 18 Nov 2026): each ticket form has its category and its own
// set of coordinators; a new ticket goes to all of them and any one assigns it.
// Kept with the form (not a version), so changing them needs no new version.
export function TicketFormSetup({ typeId, setup, people }: { typeId: number; setup: TicketFormSetupData; people: { id: number; label: string; detail?: string }[] }) {
  const { result, pending, onSubmit } = useActionForm(saveTicketFormSetupAction);
  const missing = !setup.categoryId || setup.coordinatorIds.length === 0;
  return (
    <section className="card mb-8 px-5 py-4" aria-labelledby="ticket-setup-heading" data-testid="ticket-form-setup">
      <div className="mb-3 flex items-center gap-1.5">
        <h2 id="ticket-setup-heading" className="font-semibold">
          Category and coordinators
        </h2>
        <Hint text="A new ticket from this form is sent to every coordinator here; any one of them assigns it to an employee. Changes apply at once (no new version needed)." align="start" />
      </div>
      {missing && <p className="mb-3 rounded-md bg-warning-50 px-3 py-2 text-label text-warning-600">Choose a category and at least one coordinator: until then nobody can raise tickets with this form.</p>}
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-[16rem_1fr_auto] md:items-end">
        <input type="hidden" name="typeId" value={typeId} />
        <div>
          <label htmlFor="ticket-category" className="field-label">
            Category
          </label>
          <select id="ticket-category" name="category" defaultValue={setup.categoryId ?? ""} required className="field-input">
            <option value="" disabled>
              Choose…
            </option>
            {setup.categories.map((category) => (
              <option key={category.id} value={category.id} disabled={!category.active}>
                {category.name}
                {category.active ? "" : " (switched off)"}
              </option>
            ))}
          </select>
          <FieldError result={result} name="category" />
        </div>
        <div>
          <PeoplePicker name="coordinators" label="Coordinators" options={people} initial={setup.coordinatorIds} max={50} />
          <FieldError result={result} name="coordinators" />
        </div>
        <SubmitButton pending={pending} className="btn-compact">
          Save
        </SubmitButton>
        <div className="md:col-span-3">
          <ResultMessage result={result} />
        </div>
      </form>
    </section>
  );
}
