import { requireApiArea } from "@/server/authorization/guards";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { centreSnapshot, startBackup, startDriveCopy, startDriveFetch, startRestore, startVerify, stepRun } from "@/server/ops/backup-centre/service";

// D-408 (v1.81.0, BK-1): Super Admin → Backup, restore & migrate. GET = the
// packages and recent runs; POST = start a backup, a check, a restore or a
// Google Drive copy. Long work then moves on through runs/[id] (POST = one step).
const PACKAGE = z.string().regex(/^ars-[a-z]+-\d{8}-\d{6}(-[a-z0-9]{1,12})?\.arsbak$/);
const PASSPHRASE = z.string().max(1024);

const START = z.discriminatedUnion("action", [
  z.object({ action: z.literal("backup"), include: z.enum(["full", "database"]), keepOnServer: z.boolean(), copyToDrive: z.boolean(), passphrase: PASSPHRASE }),
  z.object({ action: z.literal("verify"), name: PACKAGE, passphrase: PASSPHRASE }),
  z.object({ action: z.literal("restore"), verifyRunId: z.number().int().positive(), mode: z.enum(["full", "database", "files", "tables"]), tables: z.array(z.string().max(64)).max(500).default([]), confirm: z.string().max(100), acceptWarnings: z.boolean().default(false), passphrase: PASSPHRASE.optional() }),
  z.object({ action: z.literal("drive-copy"), name: PACKAGE }),
  z.object({ action: z.literal("drive-fetch"), fileId: z.string().max(200), name: z.string().max(300), size: z.number().int().positive() }),
  // v1.82.0 (D-409): moves between servers.
  z.object({ action: z.literal("send"), name: PACKAGE, url: z.string().max(500), code: z.string().max(100) }),
  z.object({ action: z.literal("pull"), url: z.string().max(500), code: z.string().max(100) }),
  z.object({ action: z.literal("url-fetch"), url: z.string().max(4000) }),
  z.object({ action: z.literal("s3-copy"), name: PACKAGE }),
  z.object({ action: z.literal("s3-fetch"), key: z.string().max(300), size: z.number().int().positive() }),
  z.object({ action: z.literal("db-copy"), host: z.string().max(255), port: z.number().int(), user: z.string().max(100), database: z.string().max(64), password: z.string().max(500), confirm: z.string().max(64), targetKey: z.string().max(100).optional() }),
  z.object({ action: z.literal("live-check"), restoreRunId: z.number().int().positive() }),
]);

export async function GET() {
  const actor = await centreActor(await requireApiArea("superadmin").catch(() => null));
  if (!actor) return notFound();
  try {
    return apiSuccess(await centreSnapshot(), { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup centre list failed");
  }
}

export async function POST(request: NextRequest) {
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  if (!actor) return notFound();
  const parsed = START.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_FAILED", "Check the choices and try again.", 400);
  const body = parsed.data;
  try {
    let started: { id: number; token: string | null };
    let passphrase: string | null = null;
    let secret: string | null = null;
    const moves = await import("@/server/ops/backup-centre/moves");
    if (body.action === "backup") {
      started = await startBackup(body, actor);
      passphrase = body.passphrase;
    } else if (body.action === "verify") {
      started = await startVerify(body, actor);
      passphrase = body.passphrase;
    } else if (body.action === "restore") {
      started = await startRestore(body, actor);
      passphrase = body.passphrase ?? null;
    } else if (body.action === "drive-copy") {
      started = await startDriveCopy(body.name, actor);
    } else if (body.action === "drive-fetch") {
      started = await startDriveFetch(body, actor);
    } else if (body.action === "send") {
      started = await moves.startSend(body, actor);
      secret = body.code;
    } else if (body.action === "pull") {
      started = await moves.startPull(body, actor);
      secret = body.code;
    } else if (body.action === "url-fetch") {
      started = await moves.startUrlFetch(body, actor);
    } else if (body.action === "s3-copy") {
      started = await moves.startS3Copy(body.name, actor);
    } else if (body.action === "s3-fetch") {
      started = await moves.startS3Fetch(body, actor);
    } else if (body.action === "db-copy") {
      started = await moves.startDbCopy({ ...body, targetKey: body.targetKey || null }, actor);
      secret = body.password;
    } else {
      started = await moves.startLiveCheck(body.restoreRunId, actor);
    }
    // The first step runs straight away, so a wrong passphrase shows at once.
    const run = await stepRun(started.id, { passphrase, secret }, actor);
    return apiSuccess({ run, token: started.token }, { headers: NO_STORE });
  } catch (error) {
    return failure(error, "backup centre start failed");
  }
}
