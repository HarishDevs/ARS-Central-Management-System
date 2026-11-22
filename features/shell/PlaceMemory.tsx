"use client";

import { useEffect } from "react";
import { PLACE_KEY, readPlace } from "@/features/shell/motion-rules";

// v1.80.0 (D-407, motion review point 12): keep people's place. Leaving a
// page through one of its links remembers how far down it was and which link
// was used (this browser tab only, 30 minutes). Coming back with Back (or the
// app's Back links, which use the browser's history) puts the page at the
// same height and focuses that link again, with a short highlight on its row.
const keyFor = (location: Location) => `${PLACE_KEY}:${location.pathname}${location.search}`;

export function PlaceMemory() {
  useEffect(() => {
    let timer = 0;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement | null)?.closest?.("main a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      try {
        window.sessionStorage.setItem(keyFor(window.location), JSON.stringify({ y: window.scrollY, href: link.getAttribute("href"), at: Date.now() }));
      } catch {
        // storage off: Back works as before
      }
    };
    // Back or Forward: once the page has been drawn again (the link it was
    // left by is there, or 2 s have passed), restore the place.
    const onPop = () => {
      window.clearTimeout(timer);
      let place = null;
      try {
        place = readPlace(window.sessionStorage.getItem(keyFor(window.location)), Date.now());
      } catch {
        return;
      }
      if (!place) return;
      const { y, href } = place;
      const key = keyFor(window.location);
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
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  return null;
}
