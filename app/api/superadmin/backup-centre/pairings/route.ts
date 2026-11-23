import { requireApiArea } from "@/server/authorization/guards";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { createPairing, listPairings, revokePairing } from "@/server/ops/backup-centre/moves";

// D-409 (v1.82.0): one-time pairing codes for moving the system app to app.
// RECEIVE: this server accepts one package another ARS-CMS sends. OFFER: another
// ARS-CMS may pull this one package. The code is shown once and only its hash kept.
const BODY = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), purpose: z.enum(["RECEIVE", "OFFER"]), name: z.string().max(200).optional() }),
  z.object({ action: z.literal("revoke"), id: z.number().int().positive() }),
]);

export async function GET() {
  const actor = await centreActor(await requireApiArea("superadmin").catch(() => null));
  if (!actor) return notFound();
  try {
    return apiSuccess({ pairings: await listPairings() }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup pairings list failed");
  }
}

export async function POST(request: NextRequest) {
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  if (!actor) return notFound();
  const parsed = BODY.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_FAILED", "Check the choices and try again.", 400);
  try {
    if (parsed.data.action === "revoke") {
      await revokePairing(parsed.data.id, actor);
      return apiSuccess({ revoked: parsed.data.id }, { headers: NO_STORE });
    }
    return apiSuccess(await createPairing(parsed.data.purpose, parsed.data.name ?? null, actor), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup pairing failed");
  }
}
