import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { clientIpFrom } from "@/lib/http/client-ip";
import { featureMode } from "@/server/settings/features";
import { failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { receivePieceFrom } from "@/server/ops/backup-centre/moves";
import { UPLOAD_PIECE_MAX } from "@/server/ops/backup-centre/service";

// D-409: one piece of a package another ARS-CMS sends (pairing code again;
// only at the offset received so far, so a dropped connection carries on).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if ((await featureMode("backup_centre")) === "OFF") return notFound();
  const raw = (await params).id;
  if (!/^\d{1,12}$/.test(raw)) return notFound();
  const offset = Number(request.nextUrl.searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return apiError("VALIDATION_FAILED", "Bad offset.", 400);
  if (Number(request.headers.get("content-length") ?? "0") > UPLOAD_PIECE_MAX) return apiError("VALIDATION_FAILED", "Piece too big.", 413);
  try {
    const piece = Buffer.from(await request.arrayBuffer());
    if (piece.length > UPLOAD_PIECE_MAX) return apiError("VALIDATION_FAILED", "Piece too big.", 413);
    return apiSuccess(await receivePieceFrom(Number(raw), offset, piece, request.headers.get("x-pairing-code"), clientIpFrom((name) => request.headers.get(name))), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup transfer piece failed");
  }
}
