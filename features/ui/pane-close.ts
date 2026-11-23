import { makeSureMoved } from "@/features/ui/sure-nav";
import { MOTION_DURATION } from "@/features/ui/motion";

// v1.87.0 (header and motion audit, gaps 9, 15, 17; D-417): how a pane (the
// task pane, ?task=; the record pane, ?open=) closes.
//   - Opening adds a history entry (push); closing never does. When the entry
//     before this one is the same screen without the pane, and we got here by
//     a forward move in this tab, closing goes back to it (so Back after a
//     close doesn't reopen the pane); otherwise it replaces the address.
//   - The pane plays its exit (150 ms, none with reduced motion) first.
//   - A close already under way is not started again (double clicks).
//   - A comment being sent holds the close until the save has finished.
// The decision is pure (unit-tested); the tracker is fed by PaneHistory in the shell.

export interface PaneTrail {
  prev: string | null;
  curr: string | null;
  pop: boolean; // the last move came from Back or Forward
}

const trail: PaneTrail = { prev: null, curr: null, pop: false };

export function noteLocation(url: string, pop: boolean) {
  if (url === trail.curr) {
    if (pop) trail.pop = true; // the router drew it first; popstate says it was Back/Forward
    return;
  }
  trail.prev = trail.curr;
  trail.curr = url;
  trail.pop = pop;
}

export const currentTrail = (): PaneTrail => ({ ...trail });

// One spelling for an address: path plus its query sorted (a + and %20 alike).
export function sameAddress(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const norm = (value: string) => {
    try {
      const url = new URL(value, "https://same.origin.invalid");
      const query = [...url.searchParams].sort(([x, xv], [y, yv]) => x.localeCompare(y) || xv.localeCompare(yv));
      return `${url.pathname.replace(/\/$/, "") || "/"}?${new URLSearchParams(query)}`;
    } catch {
      return value;
    }
  };
  return norm(a) === norm(b);
}

// v1.89.0 (NAV-08, D-419): may an in-app "← Back" link go back in the browser?
// Where the browser has the Navigation API, it lists this tab's entries of
// this site only: `previous` is the URL of the entry just before this one,
// or null when there is none (the tab came from another site, an email, a
// bookmark or a new tab). Back is used only when that is a page of this app
// (also after a reload or a typed address). Without the API, the tab's trail
// decides: an in-app address seen in this document's life and a forward move
// here. Otherwise the link's own in-app address is followed.
export function backStaysInApp(state: PaneTrail, here: string, previous?: string | null): boolean {
  if (previous !== undefined) {
    if (previous === null) return false;
    try {
      const url = new URL(previous, "https://same.origin.invalid");
      return url.origin === "https://same.origin.invalid" && !sameAddress(`${url.pathname}${url.search}`, here);
    } catch {
      return false;
    }
  }
  return state.prev !== null && !state.pop && sameAddress(state.curr, here) && !sameAddress(state.prev, here);
}

export function closeHow(state: PaneTrail, here: string, closeHref: string): "back" | "replace" {
  return !state.pop && sameAddress(state.curr, here) && sameAddress(state.prev, closeHref) ? "back" : "replace";
}

type Router = { back: () => void; push: (href: string, options?: { scroll?: boolean }) => void; replace: (href: string, options?: { scroll?: boolean }) => void; refresh: () => void };

const closing = new WeakSet<Element>();

export function isClosing(pane: Element | null): boolean {
  return Boolean(pane && closing.has(pane));
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Plays the pane's exit (globals.css [data-closing]) and resolves when done (at most 300 ms).
export async function playExit(pane: HTMLElement): Promise<void> {
  pane.setAttribute("data-closing", "");
  if (reducedMotion() || typeof pane.getAnimations !== "function") return;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const animations = pane.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running");
  if (!animations.length) return;
  await Promise.race([Promise.allSettled(animations.map((animation) => animation.finished)), new Promise((resolve) => setTimeout(resolve, MOTION_DURATION.emphasis))]); // a cap: the exit is --motion-dialog-out
}

export async function closePane(router: Router, pane: HTMLElement | null, closeHref: string): Promise<void> {
  if (pane) {
    if (closing.has(pane)) return;
    closing.add(pane);
    await playExit(pane);
  }
  const here = `${window.location.pathname}${window.location.search}`;
  const how = closeHow(trail, here, closeHref);
  // Read by tests: how the last pane closed.
  document.documentElement.setAttribute("data-pane-closed-by", `${how} ${trail.prev ?? "-"} -> ${closeHref} (at ${trail.curr ?? "-"}${trail.pop ? ", after Back/Forward" : ""})`);
  if (how === "back") window.history.back();
  else router.replace(closeHref, { scroll: false });
  if (pane) {
    const stillThere = pane;
    void makeSureMoved(router, here, closeHref, "replace", () => stillThere.isConnected).then(() =>
      window.setTimeout(() => {
        // All of that failed (offline): the pane comes back to life.
        if (!stillThere.isConnected) return;
        stillThere.removeAttribute("data-closing");
        closing.delete(stillThere);
      }, 1500),
    );
  }
}

// Waits until no form in the pane is being sent (gap 15), at most `limitMs`.
export function whenSaved(pane: HTMLElement, limitMs = 15_000): Promise<boolean> {
  if (!pane.querySelector('form[aria-busy="true"]')) return Promise.resolve(true);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (pane.querySelector('form[aria-busy="true"]')) return;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(true);
    });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, limitMs);
    observer.observe(pane, { subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
  });
}
