"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { navigationHeld } from "@/features/ui/UnsavedGuard";
import { transitionKind } from "@/features/shell/motion-rules";

// v1.80.0 (D-407, motion review point 4): page transitions with restraint,
// behind the Super Admin switch "page_transitions" (default OFF). With it off
// this component isn't mounted and pages change exactly as before.
// With it on (and a browser with view transitions, and no "reduce motion"):
// only the main area cross-fades (120 ms); opening a request or ticket from a
// list moves its title into the page heading; Back returns the list in place
// (PlaceMemory restores the scroll); focus goes to the new page's heading.
// A page that takes longer than 300 ms simply appears (the transition is
// skipped, so the loading bar and skeletons show as usual).
// Same-document view transitions (modern-web-guidance
// "same-document-transitions"): the browser keeps the old picture until the
// new page has been put in place, so we wait for Next to commit the route.
type ViewTransitionLike = { finished: Promise<void>; updateCallbackDone: Promise<void>; skipTransition: () => void };
type WithTransitions = Document & { startViewTransition?: (update: () => Promise<void>) => ViewTransitionLike };
export const SLOW_PAGE_MS = 300;

export function PageTransitions() {
  const pathname = usePathname();
  const search = useSearchParams();
  const routeKey = `${pathname}?${search.toString()}`;
  const commits = useRef(0);
  const waiters = useRef<Array<() => void>>([]);

  // Runs as soon as the new route is in the page (before it is painted).
  useLayoutEffect(() => {
    commits.current += 1;
    const ready = waiters.current;
    waiters.current = [];
    ready.forEach((resolve) => resolve());
  }, [routeKey]);

  useEffect(() => {
    const root = document.documentElement;
    const start = (kind: "title" | "fade", link: HTMLElement | null) => {
      const doc = document as WithTransitions;
      if (typeof doc.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || root.hasAttribute("data-vt")) return;
      const before = commits.current;
      const fromPath = window.location.pathname;
      root.setAttribute("data-vt", "fade");
      if (kind === "title" && link) link.style.setProperty("view-transition-name", "page-title");
      const clean = () => {
        root.removeAttribute("data-vt");
        link?.style.removeProperty("view-transition-name");
      };
      let transition: ViewTransitionLike;
      try {
        transition = doc.startViewTransition.call(
          doc,
          () =>
            new Promise<void>((resolve) => {
              // The old picture is taken; name the new heading instead.
              link?.style.removeProperty("view-transition-name");
              if (kind === "title") root.setAttribute("data-vt", "title");
              if (commits.current > before) return resolve();
              waiters.current.push(resolve);
              // A click that never changes the page doesn't leave it waiting.
              window.setTimeout(resolve, 4000);
            }),
        );
      } catch {
        clean();
        return;
      }
      const slow = window.setTimeout(() => transition.skipTransition(), SLOW_PAGE_MS);
      void transition.updateCallbackDone.catch(() => undefined).finally(() => window.clearTimeout(slow));
      void transition.finished
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(slow);
          clean();
          // A new page: focus its heading (the guide's accessibility routing).
          if (commits.current > before && window.location.pathname !== fromPath) {
            const heading = document.querySelector<HTMLElement>("main h1");
            if (heading) {
              if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
              heading.focus({ preventScroll: true });
            }
          }
        });
    };
    // After Next's own link handler (it runs at the React root), so the
    // navigation is already under way; a click the unsaved-changes guard
    // held back doesn't count.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || navigationHeld(event)) return;
      const link = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.getAttribute("href")?.startsWith("#")) return;
      const kind = transitionKind({ href: link.href, target: link.target, download: link.hasAttribute("download"), inRow: Boolean(link.closest("main tr, main li")) }, { href: window.location.href });
      if (kind) start(kind, kind === "title" ? link : null);
    };
    const onPop = () => start("fade", null);
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  return null;
}
