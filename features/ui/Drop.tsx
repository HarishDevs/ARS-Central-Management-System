"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useFitPanel } from "@/features/ui/fit";
import { useOverlay } from "@/features/ui/overlay-stack";

// A toolbar dropdown: a button and a panel that closes on outside clicks.
// v1.52.1 (owner): the panel opens where it is fully visible (above the button
// when there is no room below, moved in from either screen edge), and has a
// close button; a click outside or Escape still closes it.
// v1.66.3 (owner's screenshot: a section's ⋯ menu cut off and drawn under the
// next rows): `floating` places the panel against the window (position: fixed)
// so a scrolling table around the button can't clip or cover it.
export function Drop({ label, icon, buttonClass, panelClass = "left-0 w-56", testId, children, floating = false }: { label: string; icon: React.ReactNode; buttonClass: string; panelClass?: string; testId?: string; children: React.ReactNode; floating?: boolean }) {
  const box = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [edge, setEdge] = useState<React.CSSProperties>({});
  const fit = useFitPanel(open, summary, panel);
  // v1.87.0 (D-417): on the overlay stack: Escape and a click outside close
  // the panel only when it is the top overlay (a pane below stays open).
  useOverlay(open, box, {
    kind: "popover",
    restoreFocus: false,
    onOutside: () => {
      if (box.current) box.current.open = false;
    },
    onEscape: () => {
      if (!box.current?.open) return;
      // v1.72.0 (D-387): focus goes back to the button that opened the panel.
      const within = box.current.contains(document.activeElement);
      box.current.open = false;
      if (within) summary.current?.focus();
    },
  });
  // Keep the panel inside the screen sideways.
  useLayoutEffect(() => {
    if (!open || !panel.current) {
      setEdge({});
      return;
    }
    if (floating) {
      const place = () => {
        if (!panel.current || !summary.current) return;
        const button = summary.current.getBoundingClientRect();
        const width = panel.current.offsetWidth;
        const height = panel.current.scrollHeight;
        const below = window.innerHeight - button.bottom - 8;
        const above = button.top - 8;
        const up = below < Math.min(height, 240) && above > below;
        const maxHeight = Math.max(120, (up ? above : below) - 4);
        const left = Math.min(Math.max(8, button.left), window.innerWidth - width - 8);
        setEdge({ position: "fixed", left, right: "auto", zIndex: "var(--z-popover)", maxHeight, ...(up ? { top: "auto", bottom: window.innerHeight - button.top + 4 } : { top: button.bottom + 4, bottom: "auto" }) });
      };
      place();
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
      return () => {
        window.removeEventListener("resize", place);
        window.removeEventListener("scroll", place, true);
      };
    }
    const rect = panel.current.getBoundingClientRect();
    if (rect.left < 8) setEdge({ left: 0, right: "auto" });
    else if (rect.right > window.innerWidth - 8) setEdge({ right: 0, left: "auto" });
  }, [open, floating]);
  return (
    <details ref={box} className="relative" data-testid={testId} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary ref={summary} aria-label={label} className={`cursor-pointer list-none ${buttonClass}`}>
        {icon}
      </summary>
      <div
        ref={panel}
        className={`popover-surface absolute z-popover overflow-y-auto p-3 ${floating ? "" : fit.up ? "bottom-full mb-1" : "mt-1"} ${panelClass}`}
        style={{ maxHeight: fit.maxHeight, ...edge }}
        data-floating={floating || undefined}
      >
        <button
          type="button"
          aria-label={`Close ${label.toLowerCase()}`}
          onClick={() => {
            if (box.current) box.current.open = false;
          }}
          className="float-right -mr-1 -mt-1 ml-2 rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
        {children}
      </div>
    </details>
  );
}
