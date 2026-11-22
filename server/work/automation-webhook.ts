import { createHmac, timingSafeEqual, createHash, randomBytes } from "node:crypto";

// v1.68.0 (D-380): incoming webhooks of project automations. Each rule with
// a Webhook trigger has its own secret address /api/webhooks/automations/<token>
// (128 random bits) and a signing secret (256 random bits, kept encrypted).
// A caller proves it holds the secret either way:
//   X-ARS-Signature: sha256=<hex HMAC-SHA256 of the raw body with the secret>
//   Authorization: Bearer <secret>
// Both are compared in constant time.
export const newWebhookToken = () => randomBytes(16).toString("base64url");
export const newWebhookSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;
export const WEBHOOK_TOKEN = /^[A-Za-z0-9_-]{16,43}$/;

function same(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}
export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}
export function verifyWebhook(body: string, secret: string, headers: { signature: string | null; authorization: string | null }): "SIGNATURE" | "TOKEN" | null {
  if (!secret) return null;
  if (headers.signature && same(headers.signature.trim().toLowerCase(), signBody(body, secret))) return "SIGNATURE";
  const bearer = headers.authorization && /^Bearer\s+(.+)$/i.exec(headers.authorization.trim());
  if (bearer && same(bearer[1]!.trim(), secret)) return "TOKEN";
  return null;
}
