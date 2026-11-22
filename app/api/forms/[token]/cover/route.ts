import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { requireApiArea } from "@/server/authorization/guards";
import { uploadRoot } from "@/server/attachments/service";
import { inlineHeaders } from "@/server/attachments/files";
import { coverFor } from "@/server/work/intake-forms";
import { LIMITS, overLimit, tooManyResponse } from "@/server/security/limits";
import { apiError } from "@/lib/http/api-response";
import { logError } from "@/lib/logging/logger";

// v1.66.0 (D-374): a project form's cover image. Signed in, and allowed to
// open the form (the fill view's rule) or build it; anything else is the same 404.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const session = await requireApiArea("users");
    if (await overLimit(`download:${session.user.id}`, LIMITS.download)) return tooManyResponse();
    const { token } = await params;
    const cover = await coverFor(token, { id: session.user.id, name: session.user.name, roles: session.user.roles, modules: session.user.modules });
    if (!cover) return apiError("NOT_FOUND", "Not found.", 404);
    const root = uploadRoot();
    const file = path.resolve(root, cover.path);
    if (!file.startsWith(root + path.sep)) return apiError("NOT_FOUND", "Not found.", 404);
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes), { status: 200, headers: inlineHeaders("cover", cover.type, bytes.length) });
  } catch (error) {
    if ((error as Error)?.name !== "ForbiddenError") logError("form cover failed", error);
    return apiError("NOT_FOUND", "Not found.", 404);
  }
}
