import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";

// v1.89.0 (D-423, UIQA-LAY-03): an address in this area that no page has.
// The area's layout runs first (its role and page-access checks are
// unchanged: someone who may not open the area still gets the plain 404
// without the area's shell, a restricted person the "You don't have access"
// page, exactly as for a page they may not open), then this answers 404 with
// the area's not-found page inside the shell. No metadata of its own: the
// title stays the plain app name, the same as a refused page's (NAV-01,
// D-419), so an unknown address and a refused one can't be told apart.
export default async function UnknownAddress() {
  await requireArea("admin"); // the same checks as every page of the area (layout and page)
  notFound();
}
