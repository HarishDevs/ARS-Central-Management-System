import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { CurrentSession } from "@/server/auth/session";
import { featureOn } from "@/server/settings/features";
import { apiError } from "@/lib/http/api-response";
import { logError } from "@/lib/logging/logger";
import { getRun, hashToken } from "@/server/ops/backup-centre/runs";
import { CentreError, explain, type Actor } from "@/server/ops/backup-centre/service";

// D-408: who may use the centre. The Super Admin only (whatever the feature
// switch says about anyone else), and only while the switch is not OFF.
// Everyone else gets the same plain 404 as any unknown address.
export async function centreActor(session: CurrentSession | null): Promise<Actor | null> {
  try {
    if (!session || !session.user.roles.includes("SUPER_ADMIN")) return null;
    if (!(await featureOn("backup_centre", session.user))) return null;
    return { id: session.user.id, name: session.user.name, sessionId: session.sessionId };
  } catch {
    return null;
  }
}

// Steps of a run: the Super Admin's session, or the run's own token (after a
// restore switches the data, the sessions are the backup's, so the person who
// started it carries on with the token their page holds).
export async function stepActor(session: CurrentSession | null, runId: number, token: string | null): Promise<Actor | { tokenOnly: true } | null> {
  const actor = await centreActor(session);
  if (actor) return actor;
  if (!token || token.length < 20 || token.length > 100) return null;
  const item = await getRun(runId);
  if (!item?.tokenHash) return null;
  const given = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(item.tokenHash, "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? { tokenOnly: true } : null;
}

export const notFound = () => apiError("NOT_FOUND", "Not found.", 404);

export function failure(error: unknown, what: string): NextResponse {
  if (error instanceof CentreError) return apiError(error.code, error.message, error.status);
  const code = (error as { code?: string })?.code;
  if (code === "WRONG_PASSPHRASE" || code === "WRONG_SERVER_KEY" || code === "PASSPHRASE_NEEDED" || code === "SERVER_KEY_NEEDED" || code === "WEAK_PASSPHRASE" || code === "NOT_PACKAGE" || code === "DAMAGED" || code === "TRUNCATED") {
    return apiError(code, explain(error), 400);
  }
  logError(what, error);
  return apiError("SYSTEM_ERROR", explain(error), 500);
}

export const NO_STORE = { "Cache-Control": "private, no-store" };
