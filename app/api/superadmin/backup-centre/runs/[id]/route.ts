import { requireApiArea } from "@/server/authorization/guards";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound, stepActor } from "@/server/ops/backup-centre/access";
import { cancelRun, stepRun, toView } from "@/server/ops/backup-centre/service";
import { getRun } from "@/server/ops/backup-centre/runs";

// D-408: one run. GET = where it is; POST = one more step (about 20 s of
// work), with the passphrase when the server no longer holds the key;
// DELETE = stop it (only before anything was changed).
const STEP = z.object({ passphrase: z.string().max(1024).optional() });
const runId = (value: string) => (/^\d{1,12}$/.test(value) ? Number(value) : null);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = runId((await params).id);
  if (!id) return notFound();
  const who = await stepActor(await requireApiArea("superadmin", { change: true }).catch(() => null), id, request.headers.get("x-run-token"));
  if (!who) return notFound();
  const item = await getRun(id);
  return item ? apiSuccess({ run: toView(item) }, { headers: NO_STORE }) : notFound();
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = runId((await params).id);
  if (!id) return notFound();
  const who = await stepActor(await requireApiArea("superadmin", { change: true }).catch(() => null), id, request.headers.get("x-run-token"));
  if (!who) return notFound();
  const parsed = STEP.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("VALIDATION_FAILED", "Check the passphrase and try again.", 400);
  try {
    const run = await stepRun(id, { passphrase: parsed.data.passphrase ?? null }, "tokenOnly" in who ? null : who);
    return apiSuccess({ run }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup centre step failed");
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = runId((await params).id);
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  if (!id || !actor) return notFound();
  try {
    return apiSuccess({ run: await cancelRun(id, actor) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup centre cancel failed");
  }
}
