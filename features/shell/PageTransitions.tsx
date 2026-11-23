"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { navigationHeld } from "@/features/ui/UnsavedGuard";
import { transitionKind } from "@/features/shell/motion-rules";
import { MOTION_DELAY, prefersReducedMotion } from "@/features/ui/motion";
import { PANE_HOST_ATTR, taskIdFromHref } from "@/features/work/pane-open";

// v1.80.0 (D-407, motion review point 4) and v1.89.0 (D-420, on by default):
// page transitions with restraint, behind the Super Admin switch
// "page_transitions" (now default ON; the switch stays as the kill switch;
// with it off this component isn't mounted and pages change exactly as before).
// With it on (a browser with view transitions, no "reduce motion"): only the
// main area moves: the old page fades out (150 ms) and the new one fades in
// with a 4 px rise (200 ms, enter easing; globals.css "Page transitions").
// Opening a request or ticket from a list moves its title into the heading.
// Back and Forward don't animate (the browser's own history moves stay
// instant, and PlaceMemory restores the list's scroll without a jump inside
// a fade). Focus goes to the new page's heading.
//
// D-420, WebKit crash (UIQA-MOT-02): the update callback used to wait for
// Next to commit the new route for up to 4 s, and only the animation was
// skipped after 300 ms. While that callback is pending the browser holds the
// old picture and keeps the page from updating; in WebKit the route commit
// could not land during that hold, so every slow click froze the page for the
// whole 4 s, and rapid clicks stacked those holds until the page stopped
// answering. Now the hold ends at the commit or after SLOW_PAGE_MS, whichever
// comes first (the transition is then skipped, nothing waits), a second click
// during a transition ends the first one at once, and every promise of the
// transition is handled (UIQA-MOT-01: "Transition was skipped" was uncaught).
type ViewTransitionLike = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition: () => void };
type WithTransitions = Document & { startViewTransition?: (update: () => Promise<void>) => ViewTransitionLike };
export const SLOW_PAGE_MS = MOTION_DELAY.slowPage;

/** Ends a pending page transition at once (used by the next click and on unmount). */
type Active = { end: () => void };

export function PageTransitions() {
  const pathname = usePathname();
  const search = useSearchParams();
  const routeKey = `${pathname}?${search.toString()}`;
  const commits = useRef(0);
  const waiters = useRef<Array<() => void>>([]);
  const active = useRef<Active | null>(null);

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
      if (typeof doc.startViewTransition !== "function" || prefersReducedMotion()) return;
      // A click while a transition is still waiting: end it now; this move just happens.
      if (active.current) {
        active.current.end();
        return;
      }
      const before = commits.current;
      const fromPath = window.location.pathname;
      root.setAttribute("data-vt", "fade");
      if (kind === "title" && link) link.style.setProperty("view-transition-name", "page-title");
      const clean = () => {
        root.removeAttribute("data-vt");
        link?.style.removeProperty("view-transition-name");
      };
      let release: () => void = () => undefined;
      let ended = false;
      let slow = 0;
      let transition: ViewTransitionLike;
      try {
        transition = doc.startViewTransition.call(
          doc,
          () =>
            new Promise<void>((resolve) => {
              // The old picture is taken; name the new heading instead.
              link?.style.removeProperty("view-transition-name");
              if (kind === "title") root.setAttribute("data-vt", "title");
              release = resolve;
              if (ended || commits.current > before) return resolve();
              waiters.current.push(resolve);
            }),
        );
      } catch {
        clean();
        return;
      }
      const end = () => {
        ended = true;
        window.clearTimeout(slow);
        transition.skipTransition();
        release();
      };
      active.current = { end };
      // A slow page (or a click that never changes the page) never holds the old picture.
      slow = window.setTimeout(end, SLOW_PAGE_MS);
      void transition.ready.catch(() => undefined);
      void transition.updateCallbackDone.catch(() => undefined).finally(() => window.clearTimeout(slow));
      void transition.finished
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(slow);
          if (active.current?.end === end) active.current = null;
          clean();
          // A new page: focus its heading (the guide's accessibility routing),
          // unless the person has already moved focus somewhere else.
          if (commits.current > before && window.location.pathname !== fromPath) {
            const heading = document.querySelector<HTMLElement>("main h1");
            const focused = document.activeElement;
            const free = !focused || focused === document.body || focused === link || !focused.isConnected || Boolean(focused.closest("nav, [data-testid='sidebar']"));
            if (heading && free) {
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
      // A task link opens the side pane (TaskPaneHost turns it into ?task=): the page stays, nothing to animate.
      if (document.documentElement.hasAttribute(PANE_HOST_ATTR) && !link.hasAttribute("data-full-page") && taskIdFromHref(link.getAttribute("href") ?? "") !== null) return;
      const kind = transitionKind({ href: link.href, target: link.target, download: link.hasAttribute("download"), inRow: Boolean(link.closest("main tr, main li")) }, { href: window.location.href });
      if (kind) start(kind, kind === "title" ? link : null);
    };
    // Back / Forward: no transition; a transition still waiting ends now.
    const onPop = () => active.current?.end();
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
      active.current?.end();
    };
  }, []);
  return null;
}
