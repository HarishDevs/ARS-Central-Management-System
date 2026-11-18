"use client";

import { saveTicketViewersAction } from "@/app/admin/tickets/actions";
import { PeoplePicker, type PersonOption } from "@/features/ui/PeoplePicker";
import { ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";

// v1.57.0 (D-336, owner: "ticket dashboards should also be visible to IT team"):
// who else sees every ticket: the dashboards, the coordinator board, Ticket
// analytics and each ticket (read-only unless they also coordinate its form).
export function TicketViewersForm({
  departments,
  people,
  categories,
  departmentIds,
  userIds,
  categoryIds,
}: {
  departments: PersonOption[];
  people: PersonOption[];
  categories: { id: number; name: string }[];
  departmentIds: number[];
  userIds: number[];
  categoryIds: number[];
}) {
  const { result, pending, onSubmit } = useActionForm(saveTicketViewersAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Who else sees every ticket" data-testid="ticket-viewers">
      <div className="grid gap-4 md:grid-cols-2">
        <PeoplePicker name="viewerDepartments" kind="department" options={departments} label="Departments" help="Everyone in these departments, e.g. the IT department." max={50} initial={departmentIds} />
        <PeoplePicker name="viewerPeople" options={people} label="People" help="Named people, wherever they work." max={200} initial={userIds} />
      </div>
      {/* v1.57.1 (D-338): e.g. the IT department for IT Software and IT Hardware only. */}
      <fieldset>
        <legend className="field-label">Categories they see</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {categories.map((category) => (
            <label key={category.id} className="inline-flex items-center gap-2 text-label">
              <input type="checkbox" name="viewerCategories" value={category.id} defaultChecked={categoryIds.includes(category.id)} /> {category.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-caption text-ink-muted">Tick none for every category. A category&apos;s own coordinators always see its tickets.</p>
      </fieldset>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}
