import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { apiError } from "@/lib/http/api-response";
import { getRequestContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import { hasModule } from "@/server/modules/modules";
import type { TaskActor } from "@/server/modules/tasks";
import { overLimit } from "@/server/security/limits";
import { exportCsv, exportFileName, exportTable, exportXlsx } from "@/server/work/project-io";
import { projectJson } from "@/server/work/templates";
import { XLSX_MIME } from "@/server/import/xlsx";
import type { NextRequest } from "next/server";

// v1.70.0 (D-383): download a project: ?format=csv | xlsx (the List's
// columns with custom fields; anyone who sees the project) or json (the full
// structure, the same shape as a template; owners and editors). Behind the
// "pm_extras" switch; 10 downloads a minute per person.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actor: TaskActor;
  try {
    const session = await requireApiArea("users");
    if (!(await featureOn("tasks", session.user))) return apiError("NOT_FOUND", "Not found.", 404);
    if (session.user.modules && !hasModule({ roles: session.user.roles, modules: session.user.modules }, "PROJECT")) return apiError("NOT_FOUND", "Not found.", 404);
    actor = { id: session.user.id, name: session.user.name, roles: session.user.roles, modules: session.user.modules, sessionId: session.sessionId, ipAddress: getRequestContext(request).ipAddress };
  } catch {
    return apiError("NOT_FOUND", "Not found.", 404);
  }
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) return apiError("NOT_FOUND", "Not found.", 404);
  const format = request.nextUrl.searchParams.get("format") ?? "csv";
  if (!["csv", "xlsx", "json"].includes(format)) return apiError("INVALID", "Choose CSV, Excel or JSON.", 400);
  if (await overLimit(`pm-export:${actor.id}`, 10)) return apiError("RATE_LIMITED", "At most 10 downloads a minute. Wait a minute and try again.", 429);
  try {
    const headers = (type: string, name: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (format === "json") {
      const result = await projectJson(Number(id), actor);
      if (!result.ok) return apiError(result.message === "Not found." ? "NOT_FOUND" : "FORBIDDEN", result.message, result.message === "Not found." ? 404 : 403);
      return new Response(JSON.stringify(result.value.body, null, 2), { headers: headers("application/json; charset=utf-8", exportFileName(result.value.name, "json")) });
    }
    const table = await exportTable(Number(id), actor);
    if (!table.ok) return apiError(table.message === "Not found." ? "NOT_FOUND" : "FORBIDDEN", table.message, table.message === "Not found." ? 404 : 403);
    if (format === "xlsx") return new Response(exportXlsx(table.value), { headers: headers(XLSX_MIME, exportFileName(table.value.projectName, "xlsx")) });
    return new Response(exportCsv(table.value), { headers: headers("text/csv; charset=utf-8", exportFileName(table.value.projectName, "csv")) });
  } catch (error) {
    logError("project export failed", error);
    return apiError("SYSTEM_ERROR", "Couldn't make the file. Please try again.", 500);
  }
}
