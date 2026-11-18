import "server-only";
import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { hasModule } from "@/server/modules/modules";
import { isAdminActor } from "@/server/modules/tasks";
import { seesAllTickets } from "@/lib/db/repositories/tickets.repository";

// v1.55.1 (D-329): Ticketing is a module. Its lists, Raise a ticket and the
// dashboards need the TICKET module (else a plain 404); a ticket's own page is
// open to the people on it (partyOpen: requester, coordinators, assignee),
// and the service decides what each of them sees.
export async function ticketsPage(options: { partyOpen?: boolean } = {}) {
  const { user } = await requireArea("users");
  if (!options.partyOpen && !hasModule(user, "TICKET")) notFound();
  // v1.57.0 (D-336): "isAdmin" here means "sees every ticket" (IT, or the
  // departments and people named in Admin → Ticket categories).
  return { user, isAdmin: isAdminActor(user) || (await seesAllTickets(user.id)) };
}
