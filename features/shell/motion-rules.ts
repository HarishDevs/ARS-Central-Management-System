// v1.80.0 (D-407): small rules behind the shell's motion and keyboard helpers
// (unit-tested in tests/ui/motion-rules.test.ts).

// Page transitions (point 4): which clicks may animate. Internal pages only,
// never the API, a download, a new tab, or a click with a modifier key.
export function transitionKind(link: { href: string; target?: string; download?: boolean; inRow?: boolean }, here: { href: string }): "title" | "fade" | null {
  if (link.target === "_blank" || link.download) return null;
  let url: URL;
  let current: URL;
  try {
    url = new URL(link.href, here.href);
    current = new URL(here.href);
  } catch {
    return null;
  }
  if (url.origin !== current.origin || url.pathname.startsWith("/api/")) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  // Opening a request or ticket from a list: its title moves into the heading.
  if (link.inRow && /^\/users\/(requests|tickets)\/\d+$/.test(url.pathname) && url.pathname !== current.pathname) return "title";
  return "fade";
}

// Keyboard flow (point 13): the row j / k moves to (wraps at neither end).
export function nextRowIndex(count: number, current: number, key: "j" | "k"): number | null {
  if (count <= 0) return null;
  if (current < 0) return key === "j" ? 0 : count - 1;
  return key === "j" ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
}

// Keep people's place (point 12): what is remembered for a page left from a
// list, and how long it is kept (this browser tab only).
export const PLACE_KEY = "ars.place";
export const PLACE_TTL_MS = 30 * 60 * 1000;
export type Place = { y: number; href: string | null; at: number };

export function readPlace(raw: string | null, now: number): Place | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Place>;
    if (typeof value.y !== "number" || !Number.isFinite(value.y) || typeof value.at !== "number" || now - value.at > PLACE_TTL_MS) return null;
    return { y: Math.max(0, value.y), href: typeof value.href === "string" && value.href.startsWith("/") ? value.href : null, at: value.at };
  } catch {
    return null;
  }
}
