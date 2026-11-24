import { USERS_ROUTE_PATTERNS } from "./users-routes";

// v1.85.1 (D-413): the @pane slot (v1.83.0, D-410) is a catch-all, so Next
// treats every /users address as a route and an unknown one went through the
// users layout (200: the shell's not-found, or "You don't have access" for a
// person with page restrictions). The middleware asks this first and sends an
// address no page has to the real 404, before any layout runs, for everyone.
const KNOWN = USERS_ROUTE_PATTERNS.map((pattern) => new RegExp(pattern));

// Where the middleware rewrites an unknown /users address. v1.89.0 (D-423,
// UIQA-LAY-03): app/users/[...unknown] (status 404, the users not-found page
// inside the shell, after the users layout's checks); it was the root 404
// (no shell) before. The rewrite keeps the address the person typed.
export const UNKNOWN_PAGE_REWRITE = "/users/__unknown-address";

export function isUnknownUsersPath(pathname: string): boolean {
  if (!/^\/users(\/|$)/.test(pathname)) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return !KNOWN.some((pattern) => pattern.test(path));
}
