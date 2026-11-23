import "server-only";
import { parseReturnTo, type ReturnTo } from "@/lib/nav/return-to";
import { evaluateAreaAccess } from "@/server/authorization/policy";
import type { AuthenticatedUser } from "@/types/auth";

// v1.89.0 (NAV-04, D-419): the validated ?from= way back for every record's
// full page (request, task, ticket, meeting, information), decided on the
// server: same site, an allow-listed list (lib/nav/return-to.ts), in an area
// this person may open. A non-admin never gets an /admin link; anything else
// is ignored and the page keeps its own way back.
export function returnToFor(user: AuthenticatedUser, raw: unknown): ReturnTo | null {
  return parseReturnTo(raw, (area) => evaluateAreaAccess(user, area).allowed);
}
