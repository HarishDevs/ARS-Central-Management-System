// D-229: the cookie that remembers a collapsed sidebar (read by AppShell on the server).
// "rail" or "open": the person's own choice, which always wins.
export const SIDEBAR_COOKIE = "ars_sidebar";

// v1.89.0 (D-421, UIQA-RESP-02): with no saved choice, tablets (768-1279 px)
// start with the sidebar folded to the 72 px rail and wider windows with it
// open. The browser writes its width class here so the server draws the right
// sidebar on the next page (no jump); the very first page is corrected on the
// client.
export const SIDEBAR_WIDTH_COOKIE = "ars_vw";
export const TABLET_MIN_WIDTH = 768;
export const TABLET_MAX_WIDTH = 1279;
export type SidebarWidthClass = "tablet" | "wide";

export function sidebarWidthClass(width: number): SidebarWidthClass {
  return width >= TABLET_MIN_WIDTH && width <= TABLET_MAX_WIDTH ? "tablet" : "wide";
}

// The server's starting state: the saved choice, else folded on a tablet;
// null when the window's width isn't known yet (a device's first page: the
// sidebar then draws both and CSS shows the right one, so nothing moves).
export function initialSidebar(saved: string | undefined, widthClass: string | undefined): { collapsed: boolean | null; saved: boolean } {
  if (saved === "rail" || saved === "open") return { collapsed: saved === "rail", saved: true };
  if (widthClass === "tablet" || widthClass === "wide") return { collapsed: widthClass === "tablet", saved: false };
  return { collapsed: null, saved: false };
}
