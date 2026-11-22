import "server-only";
import crypto from "node:crypto";
import { getEnv } from "@/config/environment";
import { clientIpFrom } from "@/lib/http/client-ip";
import { getCurrentSession } from "@/server/auth/session";
import { evaluateAreaAccess } from "@/server/authorization/policy";
import { overLimit } from "@/server/security/limits";

// D-389 (QA security L-4): who may read the health checks' details.
//   - FULL: the monitor secret (HEALTH_SECRET env var, sent as the header
//     `x-health-secret`, compared in constant time like /api/jobs/run) or a
//     signed-in Super Admin. Sees every field (job runner, storage, backup
//     age, database clock offset).
//   - BASIC: everyone else. /api/health says only "ok" and the version;
//     /api/health/deep only "ok" or "degraded". The status codes (200/503)
//     are the same for everyone, so an uptime monitor without the secret
//     keeps working.
//   - LIMITED: an anonymous caller over 60 checks a minute from one address.
// Signed-in people are not counted per address (an office shares one).
export const HEALTH_PER_MINUTE = 60;
export type HealthAccess = "FULL" | "BASIC" | "LIMITED";

export function healthSecretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function healthAccess(request: Request): Promise<HealthAccess> {
  if (healthSecretMatches(request.headers.get("x-health-secret"), getEnv().HEALTH_SECRET)) return "FULL";
  const session = await getCurrentSession().catch(() => null);
  if (session) return evaluateAreaAccess(session.user, "superadmin").allowed ? "FULL" : "BASIC";
  const ip = clientIpFrom((name) => request.headers.get(name)) ?? "unknown";
  return (await overLimit(`health:${ip}`, HEALTH_PER_MINUTE)) ? "LIMITED" : "BASIC";
}

export const healthHeaders = { "Cache-Control": "no-store" } as const;

export function healthTooMany(): Response {
  return Response.json({ status: "busy" }, { status: 429, headers: { ...healthHeaders, "Retry-After": "60" } });
}
