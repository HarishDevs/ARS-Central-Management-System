import "server-only";
import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { hasModule } from "@/server/modules/modules";
import { isAdminActor } from "@/server/modules/tasks";
import { coordinatedCategories, viewerCategories } from "@/lib/db/repositories/tickets.repository";

// v1.55.1 (D-329): Ticketing is a module. Its lists, Raise a ticket and the
// dashboards need the TICKET module (else a plain 404); a ticket's own page is
// open to the people on it (partyOpen: requester, coordinators, assignee),
// and the service decides what each of them sees.
export async function ticketsPage(options: { partyOpen?: boolean } = {}) {
  const { user } = await requireArea("users");
  if (!options.partyOpen && !hasModule(user, "TICKET")) notFound();
  // v1.57.0 (D-336): "isAdmin" here means "sees every ticket" (IT, or the
  // departments and people named in Admin → Ticket categories for every
  // category). v1.57.1 (D-338): viewerCategoryIds = the categories they were
  // named for; categoryIds = every category they may see on the dashboards and
  // the board (those plus the categories of the forms they coordinate).
  const named = await viewerCategories(user.id);
  const isAdmin = isAdminActor(user) || named === "ALL";
  const viewerCategoryIds = named === "ALL" ? [] : named;
  const categoryIds = isAdmin ? null : [...new Set([...viewerCategoryIds, ...(await coordinatedCategories(user.id))])];
  return { user, isAdmin, viewerCategoryIds, categoryIds };
}
