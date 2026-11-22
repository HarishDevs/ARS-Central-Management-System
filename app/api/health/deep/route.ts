import { healthReport } from "@/server/ops/health";
import { healthAccess, healthHeaders, healthTooMany } from "@/server/ops/health-access";

// D-246 (audit OPS-11): for a monitor that should alert on more than "the
// site answers": 503 when the database is down, the job runner is late or
// has never run, files can't be written, or the newest backup is over 26
// hours old.
// D-389 (QA security L-4): the status code is for everyone (so an uptime
// monitor without the secret still alerts), but the body says only "ok" or
// "degraded" unless the caller sends the monitor secret (`x-health-secret`,
// env HEALTH_SECRET) or is a signed-in Super Admin, who get every field.
// Anonymous callers are limited to 60 checks a minute per address.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await healthAccess(request);
  if (access === "LIMITED") return healthTooMany();
  const report = await healthReport();
  const status = report.degraded ? 503 : 200;
  if (access === "FULL") return Response.json(report.body, { status, headers: healthHeaders });
  return Response.json({ status: report.degraded ? "degraded" : "ok" }, { status, headers: healthHeaders });
}
