// v1.58.0 (D-354, owner: "i need sorting in all the tables asc to desc or vice
// versa in all columns in all tables available in application" and "group by
// option for all the pages where table is available"): the Admin tables'
// column keys, the ORDER BY whitelists of the server-paged ones, their Group
// by choices and the group buckets. Pure (used by pages, repositories, tests).
import { sqlDir, type ColumnSort, type SortDir } from "@/server/lists/sorting";

export type GroupChoice<K extends string = string> = { key: K; label: string };

// An empty value sorts last whichever way the column goes (as sortRows does).
export const nullsLast = (expression: string, dir: SortDir) => `(${expression}) IS NULL, ${expression} ${sqlDir(dir)}`;

// ---------------------------------------------------------------- Admin → Users
// Server-paged (50 a page): every data column has a fixed SQL expression; the
// address can only pick one of these keys. "Actions" holds buttons only.
export const USER_SORT_COLUMNS = ["name", "login", "department", "signIn", "roles", "modules", "status"] as const;
export type UserSortColumn = (typeof USER_SORT_COLUMNS)[number];
// A person's active roles in one text (the same as the list's role_codes column).
const ROLE_CODES = "(SELECT GROUP_CONCAT(r.code ORDER BY r.id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.active = TRUE WHERE ur.user_id = u.id)";
export const USER_SORT_SQL: Record<UserSortColumn, string> = {
  name: "u.name",
  login: "u.login_id",
  department: "d.name",
  signIn: "u.sign_in_method",
  roles: ROLE_CODES,
  modules: "CAST(u.module_access AS CHAR)",
  // Active first (ascending), then locked, then break-glass.
  status: "(CASE WHEN u.active THEN 0 ELSE 2 END + CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END)",
};

export const USER_GROUPS = [
  { key: "department", label: "Department" },
  { key: "status", label: "Status" },
  { key: "role", label: "Role" },
  { key: "signIn", label: "Sign-in" },
] as const satisfies readonly GroupChoice[];
export type UserGroup = (typeof USER_GROUPS)[number]["key"];
// Grouped pages are ordered by the group first, so a group stays together across pages.
export const USER_GROUP_SQL: Record<UserGroup, string> = {
  department: "(d.name IS NULL), d.name",
  status: "u.active DESC",
  role: `(${ROLE_CODES}) IS NULL, ${ROLE_CODES}`,
  signIn: "u.sign_in_method",
};

export function adminUserOrderBy(sort: ColumnSort<UserSortColumn>, group: UserGroup | null = null): string {
  const parts: string[] = [];
  if (group) parts.push(USER_GROUP_SQL[group]);
  if (sort.sortBy) parts.push(nullsLast(USER_SORT_SQL[sort.sortBy], sort.dir));
  else parts.push("u.active DESC", "u.name");
  parts.push("u.id");
  return parts.join(", ");
}

// --------------------------------------------------------------- Group menus
// The Group menu of a list for ListToolbar: "None" and each choice, as links
// that keep the rest of the address (filters, sort) and go back to page 1.
export function groupHref(path: string, query: Record<string, unknown>, group: string | null): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "group" || key === "page" || value === undefined || value === null || value === "") continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  if (group) params.set("group", group);
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function groupMenu(path: string, query: Record<string, unknown>, choices: readonly GroupChoice[], current: string | null): { label: string | null; clearHref: string; choices: { label: string; href: string; active: boolean }[] } {
  return {
    label: choices.find((choice) => choice.key === current)?.label ?? null,
    clearHref: groupHref(path, query, null),
    choices: [{ label: "None", href: groupHref(path, query, null), active: !current }, ...choices.map((choice) => ({ label: choice.label, href: groupHref(path, query, choice.key), active: choice.key === current }))],
  };
}

// What a filter form must carry so Apply keeps the sort and the group.
export function keepListState(query: Record<string, unknown>): Record<string, string | undefined> {
  const one = (value: unknown) => (typeof value === "string" && value ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined);
  return { sortBy: one(query.sortBy), dir: one(query.dir), group: one(query.group) };
}

// ------------------------------------------------------------- group buckets
// Each returns [label, order]: lower order first, ties by label (groupRows).
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
// A month, newest first ("No date" last).
export function monthBucket(at: Date | null | undefined): [string, number] {
  if (!at) return ["No date", Number.MAX_SAFE_INTEGER];
  const india = new Date(new Date(at).getTime() + 330 * 60_000);
  return [MONTH.format(new Date(at)), -(india.getUTCFullYear() * 12 + india.getUTCMonth())];
}

// How long something has waited, in days.
export function ageBucket(days: number): [string, number] {
  if (days < 1) return ["Today", 0];
  if (days <= 3) return ["1–3 days", 1];
  if (days <= 7) return ["4–7 days", 2];
  if (days <= 30) return ["8–30 days", 3];
  return ["Over 30 days", 4];
}

// A workload row's oldest wait (hours).
export function oldestBucket(hours: number): [string, number] {
  if (hours < 24) return ["Under 1 day", 0];
  if (hours < 72) return ["1–3 days", 1];
  if (hours < 168) return ["3–7 days", 2];
  return ["Over 7 days", 3];
}

// A department budget's position.
export function budgetBucket(state: string): [string, number] {
  if (state === "OVER") return ["Over budget", 0];
  if (state === "WARN") return ["Near the limit", 1];
  if (state === "NO_BUDGET") return ["No budget loaded", 3];
  return ["Within budget", 2];
}

// Plain text with an order fixed by a list (unknown values after, by label).
export function listBucket(value: string | null | undefined, order: readonly string[], empty = "None"): [string, number] {
  if (!value) return [empty, order.length + 1];
  const index = order.indexOf(value);
  return [value, index === -1 ? order.length : index];
}
