import { requireApiArea } from "@/server/authorization/guards";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { startUpload, UPLOAD_PIECE_MAX } from "@/server/ops/backup-centre/service";

// D-408: upload a package from the PC in pieces (resumable, no size limit):
// POST here opens the upload; PUT uploads/[id]?offset=N sends each piece.
const BODY = z.object({ fileName: z.string().min(1).max(300), size: z.number().int().positive() });

export async function POST(request: NextRequest) {
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  if (!actor) return notFound();
  const parsed = BODY.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_FAILED", "Choose a .arsbak file.", 400);
  try {
    return apiSuccess({ id: await startUpload(parsed.data, actor), pieceSize: UPLOAD_PIECE_MAX }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup upload start failed");
  }
}
