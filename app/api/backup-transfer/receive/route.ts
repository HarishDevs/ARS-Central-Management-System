import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { clientIpFrom } from "@/lib/http/client-ip";
import { featureMode } from "@/server/settings/features";
import { failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { receiveStart } from "@/server/ops/backup-centre/moves";

// D-409 (v1.82.0): another ARS-CMS starts sending a backup package here. It
// must carry the one-time pairing code this server's Super Admin made
// (header x-pairing-code). Nothing else is reachable with it: the package
// lands in the list, and only the Super Admin can check and restore it.
const BODY = z.object({ fileName: z.string().min(1).max(300), size: z.number().int().positive() });

export async function POST(request: NextRequest) {
  if ((await featureMode("backup_centre")) === "OFF") return notFound();
  const parsed = BODY.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_FAILED", "Send fileName and size.", 400);
  try {
    return apiSuccess(await receiveStart(parsed.data, request.headers.get("x-pairing-code"), clientIpFrom((name) => request.headers.get(name))), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup transfer start failed");
  }
}
