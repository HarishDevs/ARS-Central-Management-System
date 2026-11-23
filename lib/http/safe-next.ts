// Where to go after sign-in (?next=...). Only a path inside this app: never
// another site. Browsers read "/\evil.com" and "/<tab>/evil.com" as
// "//evil.com", so backslashes and any whitespace or control character are
// refused too, and the result must resolve to this origin (audit S-02).
const BASE = "https://app.invalid";

export function safeNextPath(next: string | string[] | undefined | null, fallback = "/users"): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || value.length > 512 || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

// v1.89.0 (NAV-02, D-419): the address to come back to after a session ends:
// the path with its query (the task pane's ?task=, the view, filters, sort),
// so signing in again reopens the same screen. Checked like any ?next=; a
// value that isn't safe, or is too long, falls back to the path alone (and an
// unsafe path to the fallback).
export function returnAddress(pathname: string, search: string, fallback = "/users"): string {
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  const full = safeNextPath(`${pathname}${query}`, "");
  return full || safeNextPath(pathname, fallback);
}

// v1.89.0 (NAV-07, D-419): which area a same-origin path belongs to.
export type NextArea = "users" | "admin" | "superadmin";
export function areaOfPath(path: string): NextArea {
  if (/^\/superadmin(?:[/?#]|$)/.test(path)) return "superadmin";
  if (/^\/admin(?:[/?#]|$)/.test(path)) return "admin";
  return "users";
}

// v1.89.0 (NAV-07, D-419): where to land after sign-in. A safe ?next= in an
// area this person may open; otherwise their home page (not a 404). This only
// chooses a link: the page opened still runs its own server checks.
export function landingFor(next: string | string[] | undefined | null, canOpen: (area: NextArea) => boolean, home = "/users"): string {
  const safe = safeNextPath(next, home);
  return canOpen(areaOfPath(safe)) ? safe : home;
}
