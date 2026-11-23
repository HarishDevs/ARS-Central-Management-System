"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, type ButtonVariant } from "@/features/ui/Button";
import { closeTopLayer, supportsTopLayerExit } from "@/features/ui/top-layer";
import { openOverlay, type OverlayHandle } from "@/features/ui/overlay-stack";
import { useSwipeDown } from "@/features/ui/swipe";

// Dialogs and drawers (UI-03) on the native <dialog> element: showModal()
// makes the rest of the page inert (focus stays inside), Escape closes it,
// and focus goes back to whatever opened it.
// v1.80.0 (D-407, motion review points 1, 12, 14): they open and close
// smoothly (globals.css "ars-dialog": a fade with a small scale for dialogs,
// a slide for drawers, the backdrop fading; Firefox and Safari get a short
// closing step, top-layer.ts). `guardDraft`: once something is typed, closing
// by accident (Escape, the ×, a click outside) asks "Discard draft?" first.
// On a phone a drawer is a bottom sheet that a swipe down closes.
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "dialog",
  size = "md",
  role,
  testId,
  guardDraft = false,
  locked = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "dialog" | "drawer";
  size?: "sm" | "md" | "lg";
  role?: "alertdialog";
  testId?: string;
  guardDraft?: boolean;
  /** v1.87.0 (D-417, audit gap 13): while true (an action under way) Escape, × and a click outside don't close it. */
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const dirty = useRef(false);
  const [asking, setAsking] = useState(false);
  const stackEntry = useRef<OverlayHandle | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // The content stays while the closing animation plays.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dirty.current = false;
      dialog.removeAttribute("data-closing");
      dialog.style.removeProperty("translate");
      dialog.showModal();
      // v1.87.0 (D-417): on the overlay stack (the browser keeps Escape, trap and inert).
      stackEntry.current?.release();
      stackEntry.current = openOverlay({ element: dialog, kind: "dialog", native: true, restoreFocus: false });
      // showModal focuses the first control (the close button); a field
      // marked data-autofocus (e.g. the comment box) is where typing starts.
      requestAnimationFrame(() => dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus());
    } else if (open && dialog.open && dialog.hasAttribute("data-closing")) {
      // v1.89.0 (D-419): opened again while its closing animation still plays
      // (Firefox, Safari: e.g. Keep editing, then Back at once asks again):
      // the close is called off (closeTopLayer sees data-closing gone), so the
      // old close can't shut the dialog that was just asked for.
      dialog.removeAttribute("data-closing");
    } else if (!open && dialog.open) {
      void closeTopLayer(dialog);
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onNativeClose = () => {
      stackEntry.current?.release();
      stackEntry.current = null;
      setShown(false);
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
      onClose();
    };
    dialog.addEventListener("close", onNativeClose);
    return () => dialog.removeEventListener("close", onNativeClose);
  }, [onClose]);

  // A close the person may not have meant (Escape, ×, outside click).
  const requestClose = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || lockedRef.current) return;
    if (guardDraft && dirty.current) {
      setAsking(true);
      return;
    }
    void closeTopLayer(dialog);
  }, [guardDraft]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Escape: route through requestClose so it animates (Firefox, Safari)
    // and asks about a draft. Chrome animates its own close already.
    const onCancel = (event: Event) => {
      if (lockedRef.current) {
        event.preventDefault();
        return;
      }
      if (guardDraft && dirty.current) {
        event.preventDefault();
        setAsking(true);
        return;
      }
      if (!supportsTopLayerExit()) {
        event.preventDefault();
        void closeTopLayer(dialog);
      }
    };
    const onInput = () => {
      dirty.current = true;
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("input", onInput);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("input", onInput);
    };
  }, [guardDraft]);

  const sheet = useSwipeDown(variant === "drawer", requestClose);

  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg";
  const placement =
    variant === "drawer"
      ? `mb-0 mt-auto w-full max-w-none rounded-b-none rounded-t-xl sm:mb-auto sm:mr-0 sm:ml-auto sm:mt-0 sm:h-full sm:max-h-none sm:w-[28rem] sm:rounded-none`
      : `w-[calc(100%-2rem)] rounded-xl ${width}`;
  return (
    <dialog
      ref={ref}
      role={role}
      data-testid={testId}
      data-variant={variant}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself) closes it.
        if (event.target === ref.current) requestClose();
      }}
      className={`ars-dialog z-dialog max-h-[90dvh] border border-line bg-raised p-0 text-ink shadow-overlay ${placement}`}
    >
      {(open || shown) && (
        <div className="flex max-h-[inherit] flex-col pb-[env(safe-area-inset-bottom)]">
          {variant === "drawer" && (
            <div {...sheet} className="flex touch-none justify-center pt-2 sm:hidden" data-testid="sheet-handle" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>
          )}
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4" {...(variant === "drawer" ? sheet : {})}>
            <div>
              <h2 id={titleId} className="font-semibold">
                {title}
              </h2>
              {description && (
                <div id={descriptionId} className="mt-1 text-label text-ink-muted">
                  {description}
                </div>
              )}
            </div>
            <button type="button" onClick={requestClose} aria-label="Close" disabled={locked} className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink">
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
      {guardDraft && (
        <DiscardDraftDialog
          open={asking}
          onKeep={() => setAsking(false)}
          onDiscard={() => {
            setAsking(false);
            dirty.current = false;
            if (ref.current) void closeTopLayer(ref.current);
          }}
        />
      )}
    </dialog>
  );
}

// v1.80.0 (D-407, point 12): one question for a draft closed by accident.
export function DiscardDraftDialog({ open, onKeep, onDiscard }: { open: boolean; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onKeep}
      title="Discard draft?"
      description="What you typed here hasn't been saved."
      size="sm"
      role="alertdialog"
      testId="discard-draft"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onKeep} data-autofocus>
            Keep editing
          </Button>
          <Button variant="danger" size="sm" onClick={onDiscard}>
            Discard
          </Button>
        </>
      }
    />
  );
}

// FB: one confirmation pattern for high-impact actions. Says what will
// happen, names the item, and names the action on the button.
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  busyLabel,
  busy = false,
  tone = "primary",
  children,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  tone?: Extract<ButtonVariant, "primary" | "danger">;
  children?: React.ReactNode;
}) {
  // v1.87.0 (D-417, audit gap 13): one confirmation per opening, even on a
  // quick double click before `busy` arrives; busy also stops Escape, × and
  // a click outside from closing it mid-way.
  const fired = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!open || !busy) fired.current = false;
  }, [open, busy]);
  const confirm = () => {
    if (fired.current || busy) return;
    fired.current = true;
    onConfirm();
    // A confirmation that doesn't report busy can be pressed again a moment later (e.g. after a refusal).
    window.setTimeout(() => {
      if (!busyRef.current) fired.current = false;
    }, 800);
  };
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={body}
      size="sm"
      role="alertdialog"
      locked={busy}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} size="sm" onClick={confirm} loading={busy} loadingLabel={busyLabel}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
