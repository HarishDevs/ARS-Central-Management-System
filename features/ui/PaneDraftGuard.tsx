"use client";

import { useEffect, useRef, useState } from "react";
import { DiscardDraftDialog } from "@/features/ui/Dialog";
import { PANE_CLOSE_REQUEST, PANE_SELECTOR, paneHasUnsentDraft } from "@/features/ui/pane-draft";

// v1.86.0 (header and motion audit, gap 14): put inside a pane (task pane,
// record pane). While a comment or reply typed in it is unsent, closing the
// pane (Escape, ×, the dimmed page) or leaving it by a link asks "Discard
// draft?" first: Keep editing stays, Discard goes on as asked.
let passOnce = false;

export function PaneDraftGuard() {
  const self = useRef<HTMLSpanElement>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const discarded = useRef(false);

  useEffect(() => {
    const pane = self.current?.closest<HTMLElement>(PANE_SELECTOR);
    if (!pane) return;
    const onRequest = (event: Event) => {
      const close = (event as CustomEvent<{ close: () => void }>).detail?.close;
      if (typeof close === "function") setPending(() => close);
    };
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
    pane.addEventListener(PANE_CLOSE_REQUEST, onRequest);
    window.addEventListener("click", onClick, true);
    return () => {
      pane.removeEventListener(PANE_CLOSE_REQUEST, onRequest);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  return (
    <>
      <span ref={self} hidden data-pane-draft-guard />
      <DiscardDraftDialog
        open={pending !== null}
        onKeep={() => {
          setPending(null);
          if (discarded.current) {
            discarded.current = false;
            return;
          }
          // Back to the box the person was writing in.
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
