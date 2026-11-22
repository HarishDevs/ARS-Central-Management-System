import { requireApiArea } from "@/server/authorization/guards";
import { apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { listDrivePackages } from "@/server/ops/backup-centre/service";

// D-408: the packages in the Google Drive backup folder (to copy one here and restore it).
export async function GET() {
  const actor = await centreActor(await requireApiArea("superadmin").catch(() => null));
  if (!actor) return notFound();
  try {
    return apiSuccess({ files: await listDrivePackages() }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup drive list failed");
  }
}
