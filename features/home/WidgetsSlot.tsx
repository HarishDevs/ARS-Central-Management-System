"use client";

import { useCallback, useSyncExternalStore } from "react";

// v1.86.0 (H-01, header audit): where the widget board draws + Add widgets and
// Customise. The quick-action row's slot registers its DOM node through a
// callback ref; the board subscribes, so it always portals into the slot that
// is on screen now. Before, the board looked the slot up once by id on mount,
// and when React replaced the slot on an overview switch (Task Management ↔
// Meetings) the buttons stayed in the detached old node and vanished.
let current: HTMLElement | null = null;
const listeners = new Set<() => void>();

function publish(node: HTMLElement | null) {
  if (current === node) return;
  current = node;
  listeners.forEach((listener) => listener());
}

export function setWidgetsSlot(node: HTMLElement | null, owner?: HTMLElement | null) {
  // A slot unmounting only clears the store when it is still the registered one
  // (the new slot may already have registered during the same commit).
  if (node === null && owner && current !== owner) return;
  publish(node);
}

export function useWidgetsSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (current && current.isConnected ? current : null),
    () => null,
  );
}

export const WIDGETS_TOOLBAR_SLOT = "home-widgets-toolbar-slot";

export function WidgetsToolbarSlot() {
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setWidgetsSlot(node);
      return () => setWidgetsSlot(null, node);
    }
    return undefined;
  }, []);
  // v1.80.0 (D-407, point 15): the slot keeps the room of + Add widgets and Customise
  // (drawn after the page loads), so the row doesn't wrap late and push the page down.
  return <div ref={ref} id={WIDGETS_TOOLBAR_SLOT} className="reserve-widget-tools ml-auto flex flex-wrap items-center justify-end gap-2" data-testid="widgets-toolbar-slot" />;
}
