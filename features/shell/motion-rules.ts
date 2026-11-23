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

// v1.87.0 (D-417, gap 1): the owner's motion scale, the same values as the CSS
// variables in styles/globals.css (tests/ui/motion-tokens.test.ts keeps them
// in step). For code that has to wait for a motion or set one inline.
export const MOTION_DURATION = { instant: 100, fast: 150, base: 220, moderate: 280, slow: 350, slower: 450 } as const;
export const MOTION_EASE = {
  standard: "cubic-bezier(0.22, 1, 0.36, 1)",
  enter: "cubic-bezier(0.16, 1, 0.3, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  linear: "linear",
} as const;
export const MOTION_DISTANCE = { 1: 2, 2: 4, 3: 8, 4: 16, 5: 24, 6: 32 } as const;
// Where each part of the app takes its timing from (the documented mapping).
export const MOTION_ROLE = {
  hover: "instant",
  menu: "fast",
  tooltip: "fast",
  dialogIn: "base",
  dialogOut: "fast",
  page: "fast",
  pane: "moderate",
  sheet: "moderate",
  expand: "base",
  emphasis: "slow",
  hero: "slower",
} as const satisfies Record<string, keyof typeof MOTION_DURATION>;

// v1.87.0 (D-417, gap 19): the list a page was opened from (its address with
// the sort, filters and page, never an open pane), kept for that page in this
// tab, so its breadcrumb and Back link return to the same list.
export const ORIGIN_KEY = "ars.origin";
export const ORIGIN_TTL_MS = 60 * 60 * 1000;
const PANE_PARAMS = ["task", "open"];

export function listHref(location: { pathname: string; search: string }): string {
  const query = new URLSearchParams(location.search);
  for (const name of PANE_PARAMS) query.delete(name);
  const text = query.toString();
  return `${location.pathname}${text ? `?${text}` : ""}`;
}

// v1.89.0 (NAV-05, D-419): the users-area lists a record's page can be opened
// from, with the name its breadcrumb then shows. When a page's parent crumb is
// one of these lists and the page was opened from another of them in this tab
// (Task Summary → a task, Inbox → a request), the crumb names and links that
// list, with its query. Anything else keeps the page's own parent.
export const CROSS_LISTS: Readonly<Record<string, string>> = {
  "/users/work/my-tasks": "Task Summary",
  "/users/tasks": "Tasks",
  "/users/tasks/assigned": "Assigned by me",
  "/users/tasks/team": "My team's tasks",
  "/users/inbox": "Inbox",
  "/users/search": "Search",
  "/users/queue": "Waiting for me",
  "/users/requests": "My pending requests",
  "/users/approved": "My approved requests",
  "/users/approved-by-me": "Approved by me",
  "/users/collaborating": "Collaborating",
  "/users/tickets": "My tickets",
  "/users/meetings": "Meetings",
  "/users/information": "Information",
  "/users/information/sent": "Information",
  "/users/calendar": "Calendar",
};

export interface OriginWay {
  href: string;
  /** Set only when the way back is another list than the page's own parent. */
  label: string | null;
}

export function originWay(fallback: string, raw: string | null, now: number, crossList = false): OriginWay {
  const same = originFor(fallback, raw, now);
  if (same !== fallback || !crossList || !raw) return { href: same, label: null };
  try {
    const value = JSON.parse(raw) as { href?: unknown; at?: unknown };
    if (typeof value.href !== "string" || typeof value.at !== "number" || now - value.at > ORIGIN_TTL_MS) return { href: fallback, label: null };
    if (!value.href.startsWith("/") || value.href.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value.href)) return { href: fallback, label: null };
    const want = new URL(fallback, "https://same.origin.invalid");
    const got = new URL(value.href, "https://same.origin.invalid");
    if (got.origin !== want.origin || got.hash) return { href: fallback, label: null };
    const label = CROSS_LISTS[got.pathname];
    if (!CROSS_LISTS[want.pathname] || !label || got.pathname === want.pathname) return { href: fallback, label: null };
    return { href: `${got.pathname}${got.search}`, label };
  } catch {
    return { href: fallback, label: null };
  }
}

// The remembered list for `fallback`'s page, when it is the same page (path); else the fallback.
export function originFor(fallback: string, raw: string | null, now: number): string {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as { href?: unknown; at?: unknown };
    if (typeof value.href !== "string" || typeof value.at !== "number" || now - value.at > ORIGIN_TTL_MS) return fallback;
    if (!value.href.startsWith("/") || value.href.startsWith("//")) return fallback;
    const want = new URL(fallback, "https://same.origin.invalid");
    const got = new URL(value.href, "https://same.origin.invalid");
    return got.origin === want.origin && got.pathname === want.pathname ? `${got.pathname}${got.search}` : fallback;
  } catch {
    return fallback;
  }
}
