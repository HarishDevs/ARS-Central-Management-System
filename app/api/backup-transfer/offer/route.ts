import type { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/http/api-response";
import { clientIpFrom } from "@/lib/http/client-ip";
import { featureMode } from "@/server/settings/features";
import { failure, NO_STORE, notFound } from "@/server/ops/backup-centre/access";
import { offerInfo, offerRead } from "@/server/ops/backup-centre/moves";

// D-409 (v1.82.0): another ARS-CMS pulls the one package this server's Super
// Admin offered, with its one-time pairing code (header x-pairing-code).
// Without offset: name, size and checksum. With ?offset=&length=: those bytes
// (at most 16 MiB). The package stays encrypted with its passphrase.
export async function GET(request: NextRequest) {
  if ((await featureMode("backup_centre")) === "OFF") return notFound();
  const code = request.headers.get("x-pairing-code");
  const ip = clientIpFrom((name) => request.headers.get(name));
  try {
    const offset = request.nextUrl.searchParams.get("offset");
    if (offset === null) return apiSuccess(await offerInfo(code, ip), { headers: NO_STORE });
    const bytes = await offerRead(code, ip, Number(offset), Number(request.nextUrl.searchParams.get("length") ?? "0"));
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length), "X-Content-Type-Options": "nosniff", ...NO_STORE } });
  } catch (error) {
    return failure(error, "backup transfer offer failed");
  }
}
