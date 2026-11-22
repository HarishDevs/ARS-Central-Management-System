import { requireApiArea } from "@/server/authorization/guards";
import { featureOn } from "@/server/settings/features";
import { apiError } from "@/lib/http/api-response";
import { getRequestContext } from "@/lib/http/request-context";
import { logError } from "@/lib/logging/logger";
import { hasModule } from "@/server/modules/modules";
import type { TaskActor } from "@/server/modules/tasks";
import { overLimit } from "@/server/security/limits";
import { exportFileName } from "@/server/work/project-io";
import { timeCsv } from "@/server/work/time-tracking";
import type { NextRequest } from "next/server";

// v1.71.0 (D-384): the project's time entries as CSV (day, person, task,
// section, hours, minutes, note, how, logged on). Anyone who sees the
// project; only entries on tasks they may see. Behind "pm_extras"; 10
// downloads a minute per person (shared with the project export).
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
  if (await overLimit(`pm-export:${actor.id}`, 10)) return apiError("RATE_LIMITED", "At most 10 downloads a minute. Wait a minute and try again.", 429);
  try {
    const result = await timeCsv(Number(id), actor);
    if (!result.ok) return apiError("NOT_FOUND", result.message, 404);
    const name = exportFileName(`${result.value.name} time`, "csv");
    return new Response(result.value.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    logError("time export failed", error);
    return apiError("SYSTEM_ERROR", "Couldn't make the file. Please try again.", 500);
  }
}
