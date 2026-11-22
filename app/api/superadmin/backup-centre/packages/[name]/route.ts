import { requireApiArea } from "@/server/authorization/guards";
import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/http/api-response";
import { centreActor, failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { afterDownload, recordDownload, removePackage } from "@/server/ops/backup-centre/service";
import { packagePath } from "@/server/ops/backup-centre/storage";
import { logError } from "@/lib/logging/logger";

// D-408: download a package (streamed, never held in memory) or delete it.
// Every download is audited and told to every Super Admin.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const actor = await centreActor(await requireApiArea("superadmin").catch(() => null));
  const name = decodeURIComponent((await params).name);
  const file = packagePath(name);
  if (!actor || !file || !fs.existsSync(file)) return notFound();
  const size = fs.statSync(file).size;
  await recordDownload(name, actor);
  const stream = fs.createReadStream(file, { highWaterMark: 1 << 20 });
  let sent = 0;
  // Read only as fast as the browser takes it; a complete download of a
  // "download only" package removes it from the server.
  const counted = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      if (sent >= size) void afterDownload(name).catch((error) => logError("delete after download failed", error));
    },
  });
  const body = (Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>).pipeThrough(counted);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      ...NO_STORE,
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const actor = await centreActor(await requireApiArea("superadmin", { change: true }).catch(() => null));
  const name = decodeURIComponent((await params).name);
  if (!actor || !packagePath(name)) return notFound();
  try {
    return (await removePackage(name, actor)) ? apiSuccess({ deleted: name }, { headers: NO_STORE }) : notFound();
  } catch (error) {
    return failure(error, "backup package delete failed");
  }
}
