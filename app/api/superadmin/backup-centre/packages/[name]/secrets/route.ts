import { requireApiArea } from "@/server/authorization/guards";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { revealSecrets } from "@/server/ops/backup-centre/service";
import { packagePath } from "@/server/ops/backup-centre/storage";

// D-408 (v1.81.0): the server secrets inside a package, for the Super Admin's
// screen ("Show the server secrets"): needs the package's passphrase again
// (a server-key package: none), audited and told to every Super Admin.
// v1.85.1 (D-413): this file was never committed (the folder name matched the
// `*secret*` rule in .gitignore), so the button answered a bare 404; the
// folder is now listed as an exception there.
const BODY = z.object({ passphrase: z.string().max(1024).default("") });

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  const name = decodeURIComponent((await params).name);
  if (!actor || !packagePath(name)) return notFound();
  const parsed = BODY.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_FAILED", "Type the package's passphrase and try again.", 400);
  try {
    return apiSuccess(await revealSecrets(name, parsed.data.passphrase, actor), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup secrets reveal failed");
  }
}
