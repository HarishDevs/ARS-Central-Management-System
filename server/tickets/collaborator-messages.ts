import "server-only";
import type { Queryable } from "@/lib/db/client";
import { activeTicketCollaboratorIds } from "@/lib/db/repositories/tickets.repository";
import type { NotifyInput } from "@/server/notifications/notify";

// v1.92.0 (D-440, mirroring request collaborators' updates): a ticket's active
// collaborators (still active users) hear how it goes: assigned, work started,
// resolved, reopened, closed, and its public remarks. Each person once, never
// the person who acted, never someone already told by the same change.
export async function forCollaborators(ticketId: number, already: Iterable<number | null>, actorId: number | null, make: (userId: number) => NotifyInput, db: Queryable): Promise<NotifyInput[]> {
  const skip = new Set<number>();
  for (const id of already) if (id !== null) skip.add(id);
  if (actorId !== null) skip.add(actorId);
  return (await activeTicketCollaboratorIds(ticketId, db)).filter((id) => !skip.has(id)).map(make);
}
