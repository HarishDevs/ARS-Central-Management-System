import { requireApiArea } from "@/server/authorization/guards";
import { apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { listS3Packages } from "@/server/ops/backup-centre/moves";

// D-409 (v1.82.0): the packages in the S3-compatible bucket (to copy one here and restore it).
export async function GET() {
  const actor = await centreActor(await requireApiArea("superadmin").catch(() => null));
  if (!actor) return notFound();
  try {
    return apiSuccess({ files: await listS3Packages() }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup s3 list failed");
  }
}
