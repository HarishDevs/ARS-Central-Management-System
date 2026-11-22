import { requireApiArea } from "@/server/authorization/guards";
import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { cancelUpload, receivePiece, UPLOAD_PIECE_MAX } from "@/server/ops/backup-centre/service";

// D-408: one piece of an upload. A piece that doesn't start where the file
// ends is not written; the answer says where to carry on (resume after a
// dropped connection or a reload).
const uploadId = (value: string) => (/^\d{1,12}$/.test(value) ? Number(value) : null);

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  const id = uploadId((await params).id);
  if (!actor || !id) return notFound();
  const offset = Number(request.nextUrl.searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return apiError("VALIDATION_FAILED", "Bad offset.", 400);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > UPLOAD_PIECE_MAX) return apiError("VALIDATION_FAILED", "Piece too big.", 413);
  try {
    const piece = Buffer.from(await request.arrayBuffer());
    return apiSuccess(await receivePiece(id, offset, piece, actor), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup upload piece failed");
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  const id = uploadId((await params).id);
  if (!actor || !id) return notFound();
  await cancelUpload(id);
  return apiSuccess({ cancelled: id }, { headers: NO_STORE });
}
