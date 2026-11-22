import type { NextRequest } from "next/server";
import { findRuleByWebhook, recentDeliveries, recordDelivery } from "@/lib/db/repositories/automations.repository";
import { logError } from "@/lib/logging/logger";
import { LIMITS, overLimit } from "@/server/security/limits";
import { automationsLive, handleWebhook, type WebhookInput } from "@/server/work/automation-engine";
import { webhookSecretOf } from "@/server/work/automations";
import { WEBHOOK_BODY_MAX, WEBHOOK_PER_MINUTE } from "@/server/work/automation-rules";
import { verifyWebhook, WEBHOOK_TOKEN } from "@/server/work/automation-webhook";

// v1.68.0 (D-380): the incoming webhook of a project automation. Called by
// machines, not browsers. The address's token (128 random bits) finds the
// rule; the caller proves it holds the rule's secret with an HMAC-SHA256
// signature of the body (X-ARS-Signature: sha256=<hex>) or the secret as a
// bearer token, both compared in constant time (timingSafeEqual). 60 calls a
// minute per rule (and the shared webhook limit); every call is logged
// (accepted bodies kept 30 days). Unknown token, switch off: "not found".
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });
const notFound = () => reply(404, { success: false, error: { code: "NOT_FOUND", message: "Not found." } });

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!WEBHOOK_TOKEN.test(token)) return notFound();
  if (!(await automationsLive())) return notFound();
  const rule = await findRuleByWebhook(token);
  if (!rule || rule.published?.trigger?.type !== "WEBHOOK") return notFound();
  if ((await overLimit("webhook:automations", LIMITS.webhook)) || (await recentDeliveries(rule.id, 60)) >= WEBHOOK_PER_MINUTE) {
    return reply(429, { success: false, error: { code: "RATE_LIMITED", message: `At most ${WEBHOOK_PER_MINUTE} calls a minute. Wait a minute and try again.` } });
  }
  const log = (status: "ACCEPTED" | "REFUSED" | "FAILED", httpStatus: number, error: string | null, payload: unknown = null, taskId: number | null = null) =>
    recordDelivery({ automationId: rule.id, status, httpStatus, payload, taskId, error }).catch((logFailure) => logError("automation webhook: couldn't log the call", logFailure));
  const text = await request.text();
  if (text.length > WEBHOOK_BODY_MAX) {
    await log("REFUSED", 413, "Body too large.");
    return reply(413, { success: false, error: { code: "TOO_LARGE", message: `Send at most ${WEBHOOK_BODY_MAX} bytes of JSON.` } });
  }
  const secret = webhookSecretOf(rule);
  const how = secret ? verifyWebhook(text, secret, { signature: request.headers.get("x-ars-signature"), authorization: request.headers.get("authorization") }) : null;
  if (!how) {
    await log("REFUSED", 401, "Signature or token missing or wrong.");
    return reply(401, { success: false, error: { code: "UNAUTHORISED", message: "Sign the body with the rule's secret (X-ARS-Signature: sha256=…) or send it as a bearer token." } });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    await log("REFUSED", 400, "Not JSON.");
    return reply(400, { success: false, error: { code: "INVALID", message: "Send a JSON object." } });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    await log("REFUSED", 400, "Not a JSON object.");
    return reply(400, { success: false, error: { code: "INVALID", message: "Send a JSON object." } });
  }
  const key = request.headers.get("idempotency-key");
  const idempotencyKey = key && /^[A-Za-z0-9_.:-]{8,100}$/.test(key) ? key : null;
  try {
    const outcome = await handleWebhook(rule, body as WebhookInput, idempotencyKey);
    if (!outcome.ok) {
      await log("FAILED", outcome.status, outcome.message, body);
      return reply(outcome.status, { success: false, error: { code: "NOT_DONE", message: outcome.message } });
    }
    await log("ACCEPTED", outcome.status, outcome.run.error, body, outcome.taskId);
    return reply(outcome.status, { success: true, data: { taskId: outcome.taskId, taskNo: outcome.taskNo, created: outcome.created, run: outcome.run.status === "NONE" ? "ALREADY_RECEIVED" : outcome.run.status, error: outcome.run.error } });
  } catch (error) {
    logError("automation webhook failed", error);
    await log("FAILED", 500, "Failed.");
    return reply(500, { success: false, error: { code: "SYSTEM_ERROR", message: "Failed." } });
  }
}
