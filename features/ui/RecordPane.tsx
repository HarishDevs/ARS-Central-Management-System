"use client";

import Link from "next/link";
import { ExternalLink, Maximize2, PanelRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { requestPaneClose } from "@/features/ui/pane-draft";
import { PaneDraftGuard } from "@/features/ui/PaneDraftGuard";

// v1.85.0 (D-412, owner's Admin redesign): the record pane, generalised from
// the v1.83.0 task pane (D-410): a row opens the record beside the table
// (?open=<id>, so Back, refresh and a shared address keep it), ⤢ switches to
// the centred dialog and back (kept in this browser), and Open full page goes
// to the record's own page. Below 1024 px the side pane is the centred
// dialog; on a phone it fills the screen. Escape and × close it; focus moves
// in when it opens and back to the row's link when it closes.
type Mode = "side" | "dialog";
const KEY = "ars.recordPane.mode";

function readMode(): Mode {
  try {
    return window.localStorage.getItem(KEY) === "dialog" ? "dialog" : "side";
  } catch {
    return "side";
  }
}

export function RecordPane({ title, closeHref, fullHref, children, testId = "record-pane" }: { title: string; closeHref: string; fullHref: string; children: React.ReactNode; testId?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("side");
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => setMode(readMode()), []);
  useEffect(() => {
    body.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open], [data-testid=power-panel]")) return;
      event.preventDefault();
      const pane = document.querySelector<HTMLElement>("[data-record-pane]");
      if (pane) requestPaneClose(pane, () => router.push(closeHref, { scroll: false }));
      else router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Back to the row that opened it (its number link), if still there.
      requestAnimationFrame(() => {
        if (document.querySelector("[data-record-pane]")) return;
        document.querySelector<HTMLElement>(`#main a[data-open-link="${CSS.escape(fullHref)}"]`)?.focus({ preventScroll: false });
      });
    };
  }, [closeHref, fullHref, router]);
  const switchTo = (next: Mode) => {
    setMode(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  };
  const side = mode === "side";
  return (
    <div
      role="dialog"
      aria-modal={side ? undefined : true}
      aria-label={title}
      data-record-pane
      data-pane-mode={side ? "side" : "dialog"}
      data-testid={testId}
      className={side ? "fixed inset-0 z-drawer flex items-center justify-center p-0 sm:p-6 lg:inset-auto lg:bottom-0 lg:right-0 lg:top-topbar lg:z-sticky lg:block lg:w-pane lg:p-0" : "fixed inset-0 z-drawer flex items-center justify-center p-0 sm:p-6"}
    >
      <PaneDraftGuard />
      <Link href={closeHref} scroll={false} aria-label="Close" tabIndex={-1} className={`fixed inset-0 cursor-default bg-overlay ${side ? "lg:hidden" : ""}`} />
      <div
        ref={body}
        tabIndex={-1}
        className={`relative flex h-full w-full flex-col overflow-hidden bg-page shadow-2xl focus:outline-none sm:h-auto sm:max-h-full sm:max-w-3xl sm:rounded-xl ${side ? "lg:h-full lg:max-h-none lg:max-w-none lg:rounded-none lg:border-l lg:border-line lg:shadow-overlay" : ""}`}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-3 py-2">
          <h2 className="min-w-0 flex-1 truncate px-1 font-semibold">{title}</h2>
          <button
            type="button"
            onClick={() => switchTo(side ? "dialog" : "side")}
            aria-label={side ? "Open in a dialog" : "Back to the side pane"}
            title={side ? "Open in a dialog" : "Back to the side pane"}
            className="hidden h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink lg:grid"
            data-testid={side ? "record-pane-expand" : "record-pane-to-side"}
          >
            {side ? <Maximize2 aria-hidden="true" className="h-4 w-4" /> : <PanelRight aria-hidden="true" className="h-4 w-4" />}
          </button>
          <Link href={fullHref} className="inline-flex items-center gap-1 rounded px-2 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="record-pane-full">
            <ExternalLink aria-hidden="true" className="h-4 w-4" /> Open full page
          </Link>
          <Link href={closeHref} scroll={false} aria-label="Close" aria-keyshortcuts="Escape" className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="record-pane-close">
            <X aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}

// A click anywhere on a table row (not on a link, button or field in it)
// opens the row's record, like a click on its number.
export function RowClickHost() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("a, button, input, select, textarea, label, summary")) return;
      const row = target.closest<HTMLElement>("tr[data-row-href]");
      if (!row?.dataset.rowHref) return;
      if (window.getSelection()?.toString()) return; // selecting text is not a click
      router.push(row.dataset.rowHref, { scroll: false });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);
  return null;
}
