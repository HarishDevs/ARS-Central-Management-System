"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { listHref, ORIGIN_KEY, PLACE_KEY, readPlace } from "@/features/shell/motion-rules";
import { noteLocation } from "@/features/ui/pane-close";

// v1.80.0 (D-407, motion review point 12): keep people's place. Leaving a
// page through one of its links remembers how far down it was and which link
// was used (this browser tab only, 30 minutes). Coming back with Back (or the
// app's Back links, which use the browser's history) puts the page at the
// same height and focuses that link again, with a short highlight on its row.
// v1.87.0 (D-417, gaps 17–19): also from a link inside a pane (Open full
// page); the place is used once (a later Back doesn't jump to an old place);
// the list's address (sort, filters, page; not an open pane) is remembered
// for the page opened from it, so its breadcrumb and Back link return to the
// same list (OriginLink); and the tab's last moves are noted for closing a
// pane without a new history entry (pane-close.ts).
const keyFor = (location: Location) => `${PLACE_KEY}:${location.pathname}${location.search}`;

export function PlaceMemory() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    // A forward move (a link, the router); Back and Forward are noted in markPop.
    noteLocation(`${window.location.pathname}${window.location.search}`, false);
  }, [pathname, search]);

  useEffect(() => {
    let timer = 0;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement | null)?.closest?.("main a[href], [data-task-pane] a[href], [data-record-pane] a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      try {
        window.sessionStorage.setItem(keyFor(window.location), JSON.stringify({ y: window.scrollY, href: link.getAttribute("href"), at: Date.now() }));
        window.sessionStorage.setItem(`${ORIGIN_KEY}:${url.pathname}`, JSON.stringify({ href: listHref(window.location), at: Date.now() }));
      } catch {
        // storage off: Back works as before
      }
    };
    // Back or Forward: once the page has been drawn again (the link it was
    // left by is there, or 2 s have passed), restore the place.
    const onPop = () => {
      window.clearTimeout(timer);
      let place = null;
      const key = keyFor(window.location);
      try {
        place = readPlace(window.sessionStorage.getItem(key), Date.now());
        window.sessionStorage.removeItem(key);
      } catch {
        return;
      }
      if (!place) return;
      const { y, href } = place;
      const started = Date.now();
      const attempt = () => {
        if (keyFor(window.location) !== key) return;
        const link = href ? [...document.querySelectorAll<HTMLAnchorElement>("main a[href]")].find((candidate) => candidate.getAttribute("href") === href && candidate.offsetParent !== null) : null;
        const tall = document.documentElement.scrollHeight - window.innerHeight >= y - 2;
        if ((!link || !tall) && Date.now() - started < 2000) {
          timer = window.setTimeout(attempt, 50);
          return;
        }
        window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
        if (!link) return;
        link.focus({ preventScroll: true });
        const row = link.closest<HTMLElement>("tr, li");
        if (row) {
          row.setAttribute("data-row-current", "");
          window.setTimeout(() => row.removeAttribute("data-row-current"), 1600);
        }
      };
      timer = window.setTimeout(attempt, 50);
    };
    // Back or Forward: the address is already the new one when popstate fires,
    // so it is noted here (the redraw's note above then sees the same address).
    const markPop = () => noteLocation(`${window.location.pathname}${window.location.search}`, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", markPop, true);
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", markPop, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  return null;
}
