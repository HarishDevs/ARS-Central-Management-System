"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COMPACT_COOKIE } from "@/lib/ui/layout";
import { useSwipeDown } from "@/features/ui/swipe";
import { useOverlay } from "@/features/ui/overlay-stack";
import { MOTION_DURATION } from "@/features/shell/motion-rules";
import { Check, ChevronsUpDown, Minimize2, MoreHorizontal, SlidersHorizontal } from "lucide-react";

// v1.45.0 (owner: "This is asana app, use this also as reference"): the
// phone's sheets that rise from the bottom (Choose view, Manage view, a
// screen's … menu), the floating view switcher with the red +, and the big
// screen title. Children may be server-rendered (forms and links work as on
// the page). Escape, the backdrop and the handle close a sheet; focus goes
// into it and back to the button that opened it.

export function BottomSheet({ open, onClose, title, subtitle, action, children }: { open: boolean; onClose: () => void; title?: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // v1.80.0 (D-407, point 14): a swipe down on the handle or title closes it.
  const swipe = useSwipeDown(true, onClose);
  // v1.87.0 (D-417, audit gaps 8, 10–12): on the overlay stack (Escape when it
  // is on top, Tab kept inside, page scroll locked, the rest inert, focus back
  // to the button that opened it), and it slides away on close (150 ms).
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) {
      setClosing(false);
      return;
    }
    setClosing(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, reduce ? 0 : MOTION_DURATION.fast);
    return () => window.clearTimeout(timer);
  }, [open, shown]);
  useOverlay(open, root, { kind: "sheet", modal: true, onEscape: onClose });
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("a[href], button:not([disabled]), input, select, textarea")?.focus();
  }, [open]);
  if (!shown) return null;
  return (
    <div ref={root} className="fixed inset-0 z-dialog" data-testid="m-sheet" data-closing={closing || undefined}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="mob-sheet-backdrop absolute inset-0 bg-overlay" data-closing={closing || undefined} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Options"}
        data-sheet=""
        data-closing={closing || undefined}
        className="mob-sheet absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))]"
        // A tap on a link inside closes the sheet (the page then changes).
        onClick={(event) => (event.target as HTMLElement).closest("a[href]") && onClose()}
      >
        <div {...swipe} className="touch-none" data-testid="m-sheet-grip">
          <button type="button" aria-label="Close" onClick={onClose} data-swipe-handle="" className="mx-auto mt-2 flex h-6 w-16 items-center justify-center">
            <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line-strong" />
          </button>
          {title && (
            <div className="relative px-12 pb-2 pt-1 text-center">
              <h2 id={titleId} className="text-section">
                {title}
              </h2>
              {subtitle && <p className="text-[length:calc(13px*var(--text-scale,1))] text-ink-muted">{subtitle}</p>}
              {action && <div className="absolute right-4 top-1">{action}</div>}
            </div>
          )}
        </div>
        <div className="px-4">{children}</div>
      </div>
    </div>
  );
}

// A button that opens a sheet.
export function SheetButton({
  label,
  title,
  subtitle,
  className,
  children,
  content,
  testId,
}: {
  label: string;
  title?: string;
  subtitle?: string;
  className: string;
  children: React.ReactNode;
  content: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={className} data-testid={testId}>
        {children}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={title} subtitle={subtitle}>
        {content}
      </BottomSheet>
    </>
  );
}

export type SheetView = { href: string; label: string; hint?: string; current: boolean; count?: number };

// A list of choices in a sheet (Choose view, Sort): the current one is ticked.
export function SheetChoices({ items, label }: { items: SheetView[]; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.href}>
          <Link href={item.href} aria-current={item.current ? "page" : undefined} className="flex min-h-[56px] items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[length:calc(16px*var(--text-scale,1))]">{item.label}</span>
              {item.hint && <span className="block text-[length:calc(13px*var(--text-scale,1))] text-ink-muted">{item.hint}</span>}
            </span>
            {item.count ? <span className="rounded-full bg-surface-muted px-2 text-[length:calc(13px*var(--text-scale,1))] tabular-nums text-ink-muted">{item.count}</span> : null}
            {item.current && <Check aria-hidden="true" className="h-5 w-5 text-[color:var(--brand-accent-text)]" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Asana's floating pill above the tab bar: Manage view, Choose view and +.
export function ViewDock({ views, manage, add, label }: { views: SheetView[]; manage?: React.ReactNode; add?: React.ReactNode; label: string }) {
  const current = views.find((view) => view.current) ?? views[0];
  return (
    <div className="mob-dock fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-sticky flex justify-center px-4" data-testid="m-view-dock">
      <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface p-1.5 shadow-overlay">
        {manage && (
          <SheetButton label="Manage view" title="Manage view" subtitle={current?.label} content={manage} testId="m-manage-view" className="grid h-11 w-11 place-items-center rounded-full bg-surface-muted text-ink">
            <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
          </SheetButton>
        )}
        <SheetButton
          label={`Choose view, now ${current?.label ?? ""}`}
          title="Choose view"
          content={<SheetChoices items={views} label={label} />}
          testId="m-choose-view"
          className="flex h-11 min-w-[9.5rem] items-center justify-center gap-2 rounded-full bg-surface-muted px-4 text-[length:calc(15px*var(--text-scale,1))] font-medium"
        >
          {current?.label}
          <ChevronsUpDown aria-hidden="true" className="h-4 w-4 text-ink-muted" />
        </SheetButton>
        {add}
      </div>
    </div>
  );
}


// The big title, left, with the screen's … menu on the right.
export function ScreenTitle({ title, menu, menuLabel }: { title: string; menu?: React.ReactNode; menuLabel?: string }) {
  return (
    <div className="-mx-4 flex items-center justify-between gap-3 border-b border-line px-4 pb-3">
      <h1 className="min-w-0 text-page-title tracking-tight [overflow-wrap:anywhere]">{title}</h1>
      {menu && (
        <SheetButton label={menuLabel ?? `${title} options`} content={menu} testId="m-screen-menu" className="grid h-11 w-11 place-items-center rounded-full text-ink-muted">
          <MoreHorizontal aria-hidden="true" className="h-6 w-6" />
        </SheetButton>
      )}
    </div>
  );
}

// One row of a sheet menu (icon, label, optional value and chevron).
export function SheetLink({ href, icon, label, value, danger = false }: { href: string; icon: React.ReactNode; label: string; value?: string; danger?: boolean }) {
  return (
    <Link href={href} className={`flex min-h-[56px] items-center gap-4 border-b border-line py-2 last:border-b-0 ${danger ? "text-danger-600" : ""}`}>
      <span aria-hidden="true" className="text-ink-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-[length:calc(16px*var(--text-scale,1))]">{label}</span>
      {value && <span className="text-[length:calc(14px*var(--text-scale,1))] text-ink-muted">{value}</span>}
    </Link>
  );
}

// Manage view → Compact mode: one line per row. Kept in a cookie (this
// device only, a display choice) so the server draws the list that way.
export function CompactToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  return (
    <label className="flex min-h-[56px] items-center gap-4 border-b border-line py-2">
      <Minimize2 aria-hidden="true" className="h-5 w-5 text-ink-muted" />
      <span className="min-w-0 flex-1 text-[length:calc(16px*var(--text-scale,1))]">Compact mode</span>
      <input
        type="checkbox"
        role="switch"
        checked={value}
        data-testid="m-compact"
        onChange={(event) => {
          const next = event.target.checked;
          setValue(next);
          document.cookie = `${COMPACT_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="mob-switch"
      />
    </label>
  );
}
