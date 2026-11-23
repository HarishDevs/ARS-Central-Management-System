"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DiscardDraftDialog } from "@/features/ui/Dialog";
import { openOverlay, refreshOverlays, type OverlayHandle } from "@/features/ui/overlay-stack";
import { closePane, currentTrail, whenSaved } from "@/features/ui/pane-close";
import { leavesPane, PANE_SELECTOR, paneHasUnsentDraft } from "@/features/ui/pane-draft";

type NavigationLike = { currentEntry?: { index?: number } | null; addEventListener?: (type: string, listener: (event: Event) => void) => void; removeEventListener?: (type: string, listener: (event: Event) => void) => void };

// v1.86.0 (gap 14): an unsent comment or reply is never dropped by accident.
// v1.87.0 (D-417, gaps 9–12, 15, 17): the one place a pane (task pane, record
// pane) is controlled from. Put once inside the pane element:
//   - it joins the overlay stack: Escape reaches it only when it is the top
//     overlay (a menu, picker or dialog above it closes first); in dialog mode
//     (and as the centred popup below 1024 px) Tab is kept inside, the page
//     can't scroll and the rest is inert;
//   - × / the dimmed page ([data-pane-close]) and Escape close it without a
//     new history entry, after its exit motion;
//   - a typed, unsent comment asks "Discard draft?" first; a comment being
//     sent holds the close until it is saved ("Saving…").
// Focus in and out stays with PaneFocus (task pane) and RecordPane.
let passOnce = false;

function modalNow(pane: HTMLElement): boolean {
  return pane.dataset.paneMode === "dialog" || !window.matchMedia("(min-width: 1024px)").matches;
}

export function PaneControl() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const self = useRef<HTMLSpanElement>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const discarded = useRef(false);

  useEffect(() => {
    const pane = self.current?.closest<HTMLElement>(PANE_SELECTOR);
    if (!pane) return;
    const closeHref = () => pane.dataset.closeHref ?? "";
    // Close, after the checks: a save under way first, then an unsent draft.
    const requestClose = async (go: () => void) => {
      if (pane.querySelector('form[aria-busy="true"]')) {
        setSaving(true);
        const done = await whenSaved(pane);
        setSaving(false);
        if (!done || !pane.isConnected) return;
      }
      // A sent comment empties its box just after the save: give it a moment,
      // so the text that was just sent isn't taken for an unsent draft.
      const justSent = Array.from(pane.querySelectorAll<HTMLElement>("form[data-sent-at]")).some((form) => Date.now() - Number(form.dataset.sentAt) < 1000);
      if (justSent) for (let waited = 0; waited < 600 && paneHasUnsentDraft(pane); waited += 50) await new Promise((resolve) => window.setTimeout(resolve, 50));
      if (paneHasUnsentDraft(pane)) setPending(() => go);
      else go();
    };
    const close = () => void requestClose(() => void closePane(routerRef.current, pane, closeHref()));
    let handle: OverlayHandle | null = openOverlay({
      element: pane,
      kind: "pane",
      modal: () => modalNow(pane),
      escapeWhileTyping: false,
      restoreFocus: false,
      onEscape: () => {
        // A Board card lifted from the keyboard takes Escape first (WorkKeys).
        if (document.querySelector("[data-lifted]")) return;
        close();
      },
    });
    // The mode can change (⤢) and so can the width: re-read whether it is modal.
    const watch = new MutationObserver(() => refreshOverlays());
    watch.observe(pane, { attributes: true, attributeFilter: ["data-pane-mode"] });
    const wide = window.matchMedia("(min-width: 1024px)");
    wide.addEventListener("change", refreshOverlays);
    // Seen first (window, capture), before the pane host and Next's Link.
    const onClick = (event: MouseEvent) => {
      if (passOnce) {
        passOnce = false;
        return;
      }
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      if (link.closest("form")) return; // a link inside the comment box (a mention) stays
      // × and the dimmed page: close the way a pane closes (no history entry).
      if (link.hasAttribute("data-pane-close") && pane.contains(link)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      if (!paneHasUnsentDraft(pane)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPending(() => () => {
        passOnce = true;
        link.click();
      });
    };
    window.addEventListener("click", onClick, true);
    // v1.89.0 (NAV-06, D-419): browser Back (or Forward) away from a pane with
    // an unsent comment asks the same "Discard draft?" first. The App Router
    // can't cancel a Back, so this listener (window, capture: it runs before
    // the router's own) keeps the move from the router, puts the address back
    // where it was, then asks. Discard repeats the move; Keep leaves the pane
    // and its draft as they were. How far the move went: the pane's history
    // entry index against the current one (Navigation API; its index is
    // already the new one when popstate fires in Chromium, Firefox and
    // WebKit), else one step.
    let restoring = false;
    let passing = false;
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    const hereNow = () => `${window.location.pathname}${window.location.search}`;
    const indexNow = () => {
      const index = nav?.currentEntry?.index;
      return typeof index === "number" && index >= 0 ? index : null;
    };
    // The pane's own address and entry, kept up to date while it stays open (a sort, a tab).
    let paneHref = hereNow();
    let paneIndex = indexNow();
    const onEntry = () => {
      if (restoring || passing || leavesPane(paneHref, hereNow())) return;
      paneHref = hereNow();
      paneIndex = indexNow() ?? paneIndex;
    };
    nav?.addEventListener?.("currententrychange", onEntry);
    const onPop = (event: PopStateEvent) => {
      if (passing) {
        passing = false;
        return;
      }
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      // Without the Navigation API the trail (PlaceMemory, capture, earlier) says what was just left.
      const left = nav ? paneHref : currentTrail().prev;
      if (!pane.isConnected || !leavesPane(left, hereNow()) || !paneHasUnsentDraft(pane)) return;
      event.stopImmediatePropagation();
      const now = indexNow();
      const steps = paneIndex !== null && now !== null && now !== paneIndex ? paneIndex - now : 1;
      restoring = true;
      window.history.go(steps);
      setPending(() => () => {
        passing = true;
        window.history.go(-steps);
      });
    };
    window.addEventListener("popstate", onPop, true);
    return () => {
      window.removeEventListener("popstate", onPop, true);
      nav?.removeEventListener?.("currententrychange", onEntry);
      handle?.release();
      handle = null;
      watch.disconnect();
      wide.removeEventListener("change", refreshOverlays);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  return (
    <>
      <span ref={self} hidden data-pane-draft-guard />
      {saving && (
        <p role="status" className="pane-saving" data-testid="pane-saving">
          Saving… the pane closes when it&apos;s done.
        </p>
      )}
      <DiscardDraftDialog
        open={pending !== null}
        onKeep={() => {
          setPending(null);
          if (discarded.current) {
            discarded.current = false;
            return;
          }
          requestAnimationFrame(() => self.current?.closest(PANE_SELECTOR)?.querySelector<HTMLElement>('form [role="textbox"]')?.focus());
        }}
        onDiscard={() => {
          const go = pending;
          discarded.current = true;
          setPending(null);
          go?.();
        }}
      />
    </>
  );
}
