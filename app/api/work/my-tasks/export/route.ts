import type { NextRequest } from "next/server";
import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { apiError } from "@/lib/http/api-response";
import { getRequestContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import { hasModule } from "@/server/modules/modules";
import { hitRateLimit } from "@/lib/db/repositories/jobs.repository";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import { findTab } from "@/lib/db/repositories/work.repository";
import { applyGrid, DEFAULT_GRID, type GridConfig } from "@/server/work/grid";
import { parseTabConfig, TAB_VIEW_LABEL, isTabView } from "@/server/work/view-tabs";
import { tabSettings } from "@/server/work/my-sections";
import { loadTaskSummary } from "@/server/work/task-summary";
import { EXPORTS_PER_HOUR, summaryCsv, summaryFileName } from "@/server/work/my-export";

// v1.76.0 (D-401, spec §3.3, BR-MYT-018 adapted): Task Summary ▾ ▸ Sync /
// export ▸ CSV. An immediate download of the current tab (?tab=t<id> or
// v<TYPE>): its range, filters, sort, grouping and visible columns. Only the
// person's own list (a tab of anyone else's is "not found"); nothing is kept
// on the server; audited; 5 downloads an hour per person.
export async function GET(request: NextRequest) {
  let me: { id: number; roles: string[]; modules?: string[] | null };
  let sessionId: string;
  try {
    const session = await requireApiArea("users");
    if (!(await featureOn("tasks", session.user))) return apiError("NOT_FOUND", "Not found.", 404);
    if (session.user.modules && !hasModule({ roles: session.user.roles, modules: session.user.modules }, "TASK")) return apiError("NOT_FOUND", "Not found.", 404);
    me = session.user;
    sessionId = session.sessionId;
  } catch {
    return apiError("NOT_FOUND", "Not found.", 404);
  }
  const key = request.nextUrl.searchParams.get("tab") ?? "";
  if (key && !/^(t\d{1,10}|v[A-Z]{4,8})$/.test(key)) return apiError("NOT_FOUND", "Not found.", 404);
  try {
    const pmOn = await featureOn("pm_foundations", me as Parameters<typeof featureOn>[1]);
    let name = "List";
    let config: GridConfig = { ...DEFAULT_GRID, group: "section" };
    let range: "summary" | "all" = "summary";
    if (key.startsWith("t")) {
      const tab = await findTab({ scope: "MY_TASKS", id: me.id }, Number(key.slice(1)));
      if (!tab) return apiError("NOT_FOUND", "Not found.", 404);
      name = tab.name;
      range = tabSettings(tab.config).range;
      if (tab.type === "LIST") config = parseTabConfig("LIST", tab.config) as GridConfig;
    } else if (key.startsWith("v") && isTabView(key.slice(1))) name = TAB_VIEW_LABEL[key.slice(1) as keyof typeof TAB_VIEW_LABEL];
    if ((await hitRateLimit(`my-tasks-export:${me.id}`, 3600)) > EXPORTS_PER_HOUR) return apiError("RATE_LIMITED", `At most ${EXPORTS_PER_HOUR} downloads an hour. Try again later.`, 429);
    const summary = await loadTaskSummary(me.id, { range: pmOn ? range : "summary", recentOn: pmOn, mine: pmOn && config.group === "mySection" });
    const groups = applyGrid(summary.rows, { ...config, search: "" }, { today: summary.today, meId: me.id, sections: summary.dateSections, mySections: summary.mySections ?? [] });
    const { csv, rows } = summaryCsv(groups, config);
    await recordAudit({ actorUserId: me.id, action: "MY_TASKS_EXPORTED", entityType: "USER", entityId: me.id, sessionId, ipAddress: getRequestContext(request).ipAddress ?? null, metadata: { tab: key || null, rows, range } });
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${summaryFileName(name, summary.today)}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    logError("task summary export failed", error);
    return apiError("SYSTEM_ERROR", "Couldn't make the file. Please try again.", 500);
  }
}
