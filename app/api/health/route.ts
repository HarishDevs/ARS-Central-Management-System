import packageJson from "@/package.json";
import { basicHealth, healthReport } from "@/server/ops/health";
import { healthAccess, healthHeaders, healthTooMany } from "@/server/ops/health-access";

// Health check for an uptime monitor (audit X-09, D-103). Public and cheap:
// 200 when the app and the database answer, 503 when the database doesn't.
// D-389 (QA security L-4): anyone gets only {status, version}; the details
// (job runner, storage, backup age, database clock offset, "degraded") need
// the monitor secret (`x-health-secret`, env HEALTH_SECRET) or a signed-in
// Super Admin. Anonymous callers are limited to 60 checks a minute per
// address. /api/health/deep answers 503 when degraded, for a monitor that
// should alert.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await healthAccess(request);
  if (access === "LIMITED") return healthTooMany();
  if (access === "FULL") {
    const report = await healthReport();
    return Response.json(report.body, { status: report.database ? 200 : 503, headers: healthHeaders });
  }
  const database = await basicHealth();
  return Response.json({ status: database ? "ok" : "error", version: packageJson.version }, { status: database ? 200 : 503, headers: healthHeaders });
}
