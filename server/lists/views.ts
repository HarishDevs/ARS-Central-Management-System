import "server-only";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { listViews, type AnalyticsView } from "@/lib/db/repositories/analytics-views.repository";

// v1.58.0 (D-353, owner: "all the changes like filters, group, sort can be saved
// as a view in any applicable tables along with names"; views are private:
// "Only mine"). A list's views are kept in analytics_views under a target
// starting "list_" (e.g. list_meetings) with the address's own query.
export const LIST_VIEW_PREFIX = "list_";
export const isListTarget = (target: string) => /^list_[a-z0-9_]{2,55}$/.test(target);

// The addresses a list view may live on (checked when saving; the path is only
// used to refresh that page).
export const isListPath = (path: string) => /^\/(users|admin|superadmin)(\/[A-Za-z0-9_-]+)*$/.test(path);

// A saved query: plain keys and short values only (what the page's own parser
// reads again when the view is opened; nothing here is trusted).
export function cleanListQuery(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= 40) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) || key === "page") continue;
    const text = typeof value === "string" ? value : Array.isArray(value) ? value.join(",") : null;
    if (text === null || !text.length || text.length > 300 || /[\u0000-\u001f]/.test(text)) continue;
    out[key] = text;
    count += 1;
  }
  return out;
}

// The person's own views for this list (never others': views are private).
export async function myListViews(userId: number, target: string): Promise<AnalyticsView[]> {
  return (await listViews(userId, target)).filter((view) => view.mine);
}

// Opening a list with nothing in the address shows the person's default view.
// Not when the person is already on this list (e.g. pressed Clear): then the
// empty address is what they asked for. ?view=none also skips it.
// v1.72.1 (D-395): the two checks are pure (tests/ui/nav-routes-v1721.test.ts)
// and every list that opens a default view goes through openedPlainly().
export const isBareQuery = (query: Record<string, unknown>) => !Object.values(query).some((value) => value !== undefined && value !== "");
export function sameListReferer(referer: string | null | undefined, path: string): boolean {
  if (!referer) return false;
  try {
    return new URL(referer).pathname === path;
  } catch {
    return false;
  }
}
// Is this a plain opening of the list (so the default view may apply)?
export async function openedPlainly(path: string, query: Record<string, unknown>): Promise<boolean> {
  if (!isBareQuery(query)) return false;
  try {
    if (sameListReferer((await headers()).get("referer"), path)) return false;
  } catch {
    // no request headers (tests): fall through
  }
  return true;
}
export async function applyDefaultListView(userId: number, target: string, path: string, query: Record<string, unknown>): Promise<void> {
  if (!(await openedPlainly(path, query))) return;
  const preferred = (await myListViews(userId, target)).find((view) => view.isDefault && Object.keys(view.query).length > 0);
  if (preferred) redirect(`${path}?${new URLSearchParams(preferred.query).toString()}`);
}

// The current address's query, for "Save this view" (page dropped, empty values left out).
export function currentQuery(query: Record<string, unknown>): Record<string, string> {
  return cleanListQuery(Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value])));
}
