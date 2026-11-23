import "server-only";
import { requireArea } from "@/server/authorization/guards";
import { indiaToday } from "@/lib/db/repositories/collab.repository";
import { dashboardChoices } from "@/lib/db/repositories/dashboards.repository";
import { parseDashboardFilter } from "@/server/dashboards/filters";
import { applyDefaultListView } from "@/server/lists/views";

export type DashboardSearch = Promise<Record<string, string | undefined>>;

// Every dashboard page: Admin space check, today's India date, the filter
// from the address, and the filter choices.
// v1.58.0 (D-354, owner): with the dashboard's slug, also your default saved
// view (list_admin_dash_<slug>) and the address (for column sort and Group by).
export async function dashboardPage(searchParams: DashboardSearch, slug?: string) {
  const { user } = await requireArea("admin");
  const today = await indiaToday();
  const [params, choices] = await Promise.all([searchParams, dashboardChoices()]);
  if (slug) await applyDefaultListView(user.id, `list_admin_dash_${slug}`, `/admin/insights/dashboards/${slug}`, params);
  return { today, filter: parseDashboardFilter(params, today), choices, query: params as Record<string, string | undefined>, userId: user.id };
}
