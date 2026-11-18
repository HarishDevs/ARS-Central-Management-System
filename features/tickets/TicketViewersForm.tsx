"use client";

import { saveTicketViewersAction } from "@/app/admin/tickets/actions";
import { PeoplePicker, type PersonOption } from "@/features/ui/PeoplePicker";
import { ResultMessage, SubmitButton, useActionForm } from "@/features/ui/form";

// v1.57.0 (D-336, owner: "ticket dashboards should also be visible to IT team"):
// who else sees every ticket: the dashboards, the coordinator board, Ticket
// analytics and each ticket (read-only unless they also coordinate its form).
export function TicketViewersForm({ departments, people, departmentIds, userIds }: { departments: PersonOption[]; people: PersonOption[]; departmentIds: number[]; userIds: number[] }) {
  const { result, pending, onSubmit } = useActionForm(saveTicketViewersAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Who else sees every ticket" data-testid="ticket-viewers">
      <div className="grid gap-4 md:grid-cols-2">
        <PeoplePicker name="viewerDepartments" kind="department" options={departments} label="Departments" help="Everyone in these departments, e.g. the IT department." max={50} initial={departmentIds} />
        <PeoplePicker name="viewerPeople" options={people} label="People" help="Named people, wherever they work." max={200} initial={userIds} />
      </div>
      <ResultMessage result={result} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}
