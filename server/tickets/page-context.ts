import "server-only";
import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { isAdminActor } from "@/server/modules/tasks";

// v1.55.0: every ticket page: signed in to the users area and the Ticketing
// switch on for this person (else a plain 404, like any switched-off module).
export async function ticketsPage() {
  const { user } = await requireArea("users");
  if (!(await featureOn("tickets", user))) notFound();
  return { user, isAdmin: isAdminActor(user) };
}
