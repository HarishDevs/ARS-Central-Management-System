import { ADMIN_ROUTE_PATTERNS, USERS_ROUTE_PATTERNS } from "./users-routes";

// v1.85.1 (D-413): the @pane slot (v1.83.0, D-410) is a catch-all, so Next
// treats every /users address as a route and an unknown one went through the
// users layout (200: the shell's not-found, or "You don't have access" for a
// person with page restrictions). The middleware asks this first.
const KNOWN = USERS_ROUTE_PATTERNS.map((pattern) => new RegExp(pattern));
const KNOWN_ADMIN = ADMIN_ROUTE_PATTERNS.map((pattern) => new RegExp(pattern));

// v1.85.1: where an unknown /users address went (no page has it: the root
// not-found page, status 404, no shell). v1.89.0 (D-423): still used for a
// request that isn't a plain page view (a POST, a Server Action).
export const UNKNOWN_PAGE_REWRITE = "/__ars-unknown-page";

// v1.89.0 (D-423, UIQA-LAY-03): a page view of an address no page has goes
// to the area's own not-found address instead: app/<area>/[...rest] answers
// 404 with the area's not-found page inside the shell. The middleware signs
// this address (not the typed one) as the page asked for, and it is a listed
// open address (server/authorization/pages.ts OPEN_PATHS) like the "no
// access" screen, so a person with page restrictions sees "This page isn't
// available" (it was "You don't have access"); the area's role check runs
// as for every page. The browser keeps the address that was typed.
export const UNKNOWN_AREA_ADDRESS = { users: "/users/__unknown-address", admin: "/admin/__unknown-address" } as const;

const trim = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);

export function isUnknownUsersPath(pathname: string): boolean {
  if (!/^\/users(\/|$)/.test(pathname)) return false;
  const path = trim(pathname);
  return !KNOWN.some((pattern) => pattern.test(path));
}

export function isUnknownAdminPath(pathname: string): boolean {
  if (!/^\/admin(\/|$)/.test(pathname)) return false;
  const path = trim(pathname);
  return !KNOWN_ADMIN.some((pattern) => pattern.test(path));
}

// The address a request for an unknown area address is rewritten to (null = a known address,
// or another area). Page views go to the area's in-shell 404; anything else to the root 404 as before
// (Admin: nothing changes for a POST, Next answers it as it did).
export function unknownAreaRewrite(pathname: string, pageView: boolean): string | null {
  if (isUnknownUsersPath(pathname)) return pageView ? UNKNOWN_AREA_ADDRESS.users : UNKNOWN_PAGE_REWRITE;
  if (pageView && isUnknownAdminPath(pathname)) return UNKNOWN_AREA_ADDRESS.admin;
  return null;
}
