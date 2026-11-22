import { clientIpFrom } from "@/lib/http/client-ip";
import { logError } from "@/lib/logging/logger";
import { overLimit } from "@/server/security/limits";
import { feedCalendar } from "@/server/work/calendar-feeds";

// v1.70.0 (D-383): a calendar feed (iCalendar) for calendar apps, which can't
// sign in. The address's secret (256 random bits; only its SHA-256 hash is
// stored) is the key; it can be rotated or stopped by its owner. What it
// lists is decided now: open tasks with a due date that the person may see
// today. Read-only. Unknown, stopped or no longer allowed: 404.
const notFound = () => new Response("Not found.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

// D-389 (QA security L-5): also 120 a minute per calling address, so made-up
// addresses (each with a fresh per-address count) can't cost unlimited lookups.
const CALENDAR_PER_IP_PER_MINUTE = 120;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return notFound();
  const ip = clientIpFrom((name) => request.headers.get(name)) ?? "unknown";
  if ((await overLimit(`calendar-ip:${ip}`, CALENDAR_PER_IP_PER_MINUTE)) || (await overLimit(`calendar:${token.slice(0, 12)}`, 30))) return new Response("Too many requests.", { status: 429, headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" } });
  try {
    const body = await feedCalendar(token);
    if (body === null) return notFound();
    return new Response(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="ars-cms-tasks.ics"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    logError("calendar feed failed", error);
    return new Response("Failed.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
