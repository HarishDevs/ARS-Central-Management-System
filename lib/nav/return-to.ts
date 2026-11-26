// v1.87.0 (header and motion audit, gap 19; D-417): "where the person came
// from" for a record's full page reached from another area (Admin → Records
// opens a request's page in the users area). The list's address travels as
// ?from=; this decides whether it may be offered as the way back. Only a
// same-origin path, under an allow-listed prefix, in an area the person may
// open (checked by the caller on the server: evaluateAreaAccess). Anything
// else is ignored and the page's own way back is used. It only ever builds a
// link: opening it runs that page's own server checks as always.

export type ReturnArea = "users" | "admin" | "superadmin";

export interface ReturnTo {
  href: string;
  label: string;
  area: ReturnArea;
}

// The longest prefix wins. A prefix ending in "/" needs something after it.
const ALLOWED: { prefix: string; exact?: boolean; label: string; area: ReturnArea }[] = [
  { prefix: "/admin/records/", label: "Admin → Records", area: "admin" },
  { prefix: "/admin/records", exact: true, label: "Admin → Records", area: "admin" },
  { prefix: "/admin/insights", label: "Admin → Insights", area: "admin" },
  { prefix: "/admin", exact: true, label: "Admin → Overview", area: "admin" },
  { prefix: "/superadmin", exact: true, label: "Super Admin", area: "superadmin" },
  // v1.92.0 (D-441): a ticket opened from the Collaborating screen's Tickets tab goes back to that tab.
  { prefix: "/users/collaborating", exact: true, label: "Collaborating", area: "users" },
];

export const RETURN_PARAM = "from";
const MAX = 600;

export function parseReturnTo(raw: unknown, canOpen: (area: ReturnArea) => boolean): ReturnTo | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX) return null;
  // A path on this site only: no scheme, no "//host", no backslashes or control characters.
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://same.origin.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://same.origin.invalid" || url.hash) return null;
  const path = url.pathname;
  // Dot segments are resolved by URL(); refuse anything that changed shape (e.g. "/admin/../users").
  if (!raw.startsWith(path)) return null;
  const match = ALLOWED.filter((rule) => (rule.exact ? path === rule.prefix : rule.prefix.endsWith("/") ? path.startsWith(rule.prefix) && path.length > rule.prefix.length : path === rule.prefix || path.startsWith(`${rule.prefix}/`))).sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!match || !canOpen(match.area)) return null;
  return { href: `${path}${url.search}`, label: match.label, area: match.area };
}

/** The ?from= value for a link to a record's own page, from the current address. */
export function returnParam(current: { pathname: string; search: string }): string {
  return new URLSearchParams({ [RETURN_PARAM]: `${current.pathname}${current.search}` }).toString();
}
