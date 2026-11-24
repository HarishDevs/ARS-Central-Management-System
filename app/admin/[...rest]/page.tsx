import { notFound } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";

// v1.89.0 (D-423, UIQA-LAY-03): an address in this area that no page has.
// The middleware sends a page view of an unknown /admin address here
// (/admin/__unknown-address, from the generated Admin route list).
// The area's role check runs as for every page (someone who may not open the
// area still gets the plain 404 without the area's shell, as for any of its
// pages); then this answers 404 with the area's not-found page inside the
// shell. No metadata of its own: the title stays the plain app name, the
// same as a refused page's (NAV-01, D-419).
export default async function UnknownAddress() {
  await requireArea("admin"); // the same checks as every page of the area (layout and page)
  notFound();
}
