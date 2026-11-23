import { useEffect, useRef, type RefObject } from "react";

// v1.87.0 (header and motion audit, gaps 10–12; D-417): one stack for every
// overlay — Dialog and ConfirmDialog (native <dialog>), the command palette,
// BottomSheet, MobileNav, menus and popovers (Menu, bell, Drop, date and
// people pickers), the task and record panes — so that:
//   - Escape and a click outside go to the top-most overlay only;
//   - a modal overlay that is not a native <dialog> (a pane in dialog mode, a
//     sheet) traps Tab, locks the page's scroll and makes the rest inert;
//   - focus goes back to what opened an overlay when it closes;
//   - nothing is left behind (each open returns a release, called on unmount).
// Native modal dialogs keep the browser's own Escape, focus trap and inert
// (the top layer); they are registered so the stack knows they are on top.
// No library; extends features/ui/top-layer.ts (exit animations) and the
// toast host (useTopModal). The rules that decide are pure (tested).

export type OverlayKind = "dialog" | "palette" | "sheet" | "pane" | "menu" | "popover";

export interface OverlayOptions {
  element: HTMLElement;
  kind: OverlayKind;
  /** A native modal <dialog> (showModal): the browser handles Escape, inert and the trap. */
  native?: boolean;
  /** Traps focus, locks scroll and makes the rest of the page inert (non-native only). */
  modal?: boolean | (() => boolean);
  onEscape?: () => void;
  onOutside?: (target: Element) => void;
  /** A click on these (e.g. the button that opened a menu) is not "outside". */
  ignore?: (target: Element) => boolean;
  /** Escape while typing in a field inside the overlay (default: true; panes: false). */
  escapeWhileTyping?: boolean;
  /** Focus what was focused before the overlay opened, on release (default true). */
  restoreFocus?: boolean;
}

export interface OverlayEntry extends OverlayOptions {
  id: number;
  opener: Element | null;
}

export interface OverlayHandle {
  id: number;
  release: () => void;
  isTop: () => boolean;
}

const stack: OverlayEntry[] = [];
let nextId = 1;
let installed = false;
let inerted: Element[] = [];
let locked: { overflow: string; paddingRight: string } | null = null;
const listeners = new Set<() => void>();

export const isModal = (entry: Pick<OverlayEntry, "modal" | "native">) => !entry.native && (typeof entry.modal === "function" ? entry.modal() : Boolean(entry.modal));

// ---- Pure rules (unit-tested) -------------------------------------------------

/** The entry Escape belongs to: the top one, unless a native modal dialog the stack doesn't know is above it. */
export function escapeTarget(entries: readonly Pick<OverlayEntry, "id" | "native" | "onEscape" | "escapeWhileTyping">[], typing: boolean, foreignModalAbove: boolean): number | null {
  const top = entries.at(-1);
  if (!top || top.native || foreignModalAbove || !top.onEscape) return null;
  if (typing && top.escapeWhileTyping === false) return null;
  return top.id;
}

/** True when a pointer-down at `target` is outside the top overlay (and only the top one may react). */
export function outsideOfTop<T>(top: { contains: (node: T) => boolean } | null, target: T, ignored: boolean): boolean {
  if (!top || ignored) return false;
  return !top.contains(target);
}

/** The next element for Tab / Shift+Tab inside a trap (wraps at both ends). */
export function trapNext<T>(items: readonly T[], current: T | null, back: boolean): T | null {
  if (!items.length) return null;
  const index = current === null ? -1 : items.indexOf(current);
  if (index === -1) return back ? items[items.length - 1]! : items[0]!;
  if (back) return index === 0 ? items[items.length - 1]! : null;
  return index === items.length - 1 ? items[0]! : null;
}

/** Scroll is locked while any modal entry (native or not) is open. */
export const needsScrollLock = (entries: readonly Pick<OverlayEntry, "modal" | "native">[]) => entries.some((entry) => entry.native || isModal(entry));

// ---- DOM side -----------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes((target as HTMLInputElement).type);
  return false;
}

// A native modal dialog that isn't in the stack and doesn't hold the top entry.
function foreignModal(top: OverlayEntry | undefined): boolean {
  let modals: HTMLDialogElement[] = [];
  try {
    modals = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).filter((dialog) => dialog.matches(":modal"));
  } catch {
    return false;
  }
  return modals.some((dialog) => !stack.some((entry) => entry.element === dialog) && !(top && dialog.contains(top.element)));
}

function onKeyDown(event: KeyboardEvent) {
  const top = stack.at(-1);
  if (!top) return;
  if (event.key === "Escape" && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const id = escapeTarget(stack, typingIn(event.target), foreignModal(top));
    if (id === null) return;
    event.preventDefault();
    top.onEscape?.();
    return;
  }
  if (event.key === "Tab" && isModal(top)) {
    const items = Array.from(top.element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((item) => item.offsetParent !== null || item === document.activeElement);
    const active = document.activeElement instanceof HTMLElement && top.element.contains(document.activeElement) ? document.activeElement : null;
    const next = trapNext(items, active, event.shiftKey);
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }
}

function onPointerDown(event: PointerEvent) {
  const top = stack.at(-1);
  if (!top?.onOutside || !(event.target instanceof Element)) return;
  const target = event.target;
  // A click inside an overlay above the page's own layer (a toast, a native dialog the top lives in) is not outside.
  if (target.closest("[data-testid=toast-region]")) return;
  if (outsideOfTop(top.element, target, Boolean(top.ignore?.(target)))) top.onOutside(target);
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Bubble phase on the document: a component's own key handler (React, on
  // the root) runs first and may take the key (defaultPrevented).
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);
}

function applyLayers() {
  // Inert: everything outside the top-most non-native modal overlay.
  for (const element of inerted) element.removeAttribute("inert");
  inerted = [];
  const top = stack.at(-1);
  if (top && isModal(top)) {
    for (let node: Element | null = top.element; node && node !== document.body; node = node.parentElement) {
      const parent: Element | null = node.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || sibling.hasAttribute("inert") || ["SCRIPT", "STYLE", "TEMPLATE"].includes(sibling.tagName)) continue;
        if (sibling.matches("[data-testid=toast-region], [aria-live], dialog[open]") || sibling.querySelector("dialog[open], [data-testid=toast-region]")) continue;
        sibling.setAttribute("inert", "");
        inerted.push(sibling);
      }
    }
  }
  // Scroll lock with the scrollbar's room kept (no shift sideways).
  const html = document.documentElement;
  if (needsScrollLock(stack.filter((entry) => !entry.native))) {
    if (!locked) {
      const gap = window.innerWidth - html.clientWidth;
      locked = { overflow: html.style.overflow, paddingRight: document.body.style.paddingRight };
      html.style.overflow = "hidden";
      if (gap > 0) document.body.style.paddingRight = `${gap}px`;
      html.setAttribute("data-scroll-locked", "");
    }
  } else if (locked) {
    html.style.overflow = locked.overflow;
    document.body.style.paddingRight = locked.paddingRight;
    html.removeAttribute("data-scroll-locked");
    locked = null;
  }
  html.toggleAttribute("data-overlay-open", stack.length > 0);
  listeners.forEach((listener) => listener());
}

export function openOverlay(options: OverlayOptions): OverlayHandle {
  install();
  // Idempotent: the same element opened twice keeps one entry.
  const existing = stack.find((entry) => entry.element === options.element);
  if (existing) {
    Object.assign(existing, options);
    return handleFor(existing);
  }
  const entry: OverlayEntry = { ...options, id: nextId++, opener: typeof document !== "undefined" ? document.activeElement : null };
  stack.push(entry);
  applyLayers();
  return handleFor(entry);
}

function handleFor(entry: OverlayEntry): OverlayHandle {
  return {
    id: entry.id,
    isTop: () => stack.at(-1)?.id === entry.id,
    release: () => {
      const index = stack.findIndex((item) => item.id === entry.id);
      if (index === -1) return;
      stack.splice(index, 1);
      applyLayers();
      if (entry.restoreFocus === false) return;
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || entry.element.contains(active);
      if (lost && entry.opener instanceof HTMLElement && entry.opener.isConnected) entry.opener.focus({ preventScroll: true });
    },
  };
}

/** Re-reads `modal` (e.g. a pane switched between side and dialog). */
export function refreshOverlays() {
  if (typeof document !== "undefined") applyLayers();
}

export const overlayCount = () => stack.length;
export const topOverlay = (): OverlayEntry | null => stack.at(-1) ?? null;
export const isTopOverlay = (element: Element | null) => Boolean(element && stack.at(-1)?.element === element);
export const overlayKinds = () => stack.map((entry) => entry.kind);

export function subscribeOverlays(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests only: forget every entry and undo inert and scroll lock. */
export function resetOverlaysForTests() {
  stack.splice(0, stack.length);
  if (typeof document !== "undefined") applyLayers();
}

// ---- React ------------------------------------------------------------------

/** Registers `ref`'s element while `active`; the latest callbacks are always used. */
export function useOverlay(active: boolean, ref: RefObject<HTMLElement | null>, options: Omit<OverlayOptions, "element">) {
  const latest = useRef(options);
  latest.current = options;
  const handle = useRef<OverlayHandle | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const current = latest.current;
    handle.current = openOverlay({
      ...current,
      element,
      modal: typeof current.modal === "function" ? () => (latest.current.modal as () => boolean)() : current.modal,
      onEscape: current.onEscape ? () => latest.current.onEscape?.() : undefined,
      onOutside: current.onOutside ? (target) => latest.current.onOutside?.(target) : undefined,
      ignore: (target) => Boolean(latest.current.ignore?.(target)),
    });
    return () => {
      handle.current?.release();
      handle.current = null;
    };
  }, [active, ref]);
  return handle;
}
