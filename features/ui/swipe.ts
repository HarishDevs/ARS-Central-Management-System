"use client";

import { useMemo } from "react";

// v1.80.0 (D-407, motion review point 14): a bottom sheet (a drawer on a
// phone) follows a finger dragged down on its handle or header and closes
// when let go far enough down (or flicked); otherwise it springs back.
// Only `translate` changes. Wider screens (drawers at the side) ignore it.
// The drag is followed on the document (the finger soon leaves the handle),
// without pointer capture, so a tap on the handle stays a click.
export const SWIPE_CLOSE_PX = 80;

export function swipeShouldClose(distance: number, msTaken: number): boolean {
  if (distance <= 0) return false;
  if (distance >= SWIPE_CLOSE_PX) return true;
  // A quick flick: 30 px in under 200 ms.
  return distance >= 30 && msTaken > 0 && msTaken < 200;
}

type Handlers = { onPointerDown: (event: React.PointerEvent<HTMLElement>) => void };

export function useSwipeDown(enabled: boolean, onClose: () => void): Handlers | Record<string, never> {
  const handlers = useMemo<Handlers>(
    () => ({
      onPointerDown: (event) => {
        const target = event.target as HTMLElement;
        if (event.button !== 0 || window.matchMedia("(min-width: 640px)").matches) return;
        if (target.closest("button, a, input, select, textarea") && !target.closest("[data-swipe-handle]")) return;
        const sheet = event.currentTarget.closest<HTMLElement>("[data-sheet], dialog");
        if (!sheet) return;
        const start = { y: event.clientY, t: event.timeStamp, id: event.pointerId };
        const move = (next: PointerEvent) => {
          if (next.pointerId !== start.id) return;
          sheet.style.transition = "none";
          sheet.style.translate = `0 ${Math.max(0, next.clientY - start.y)}px`;
        };
        const end = (next: PointerEvent) => {
          if (next.pointerId !== start.id) return;
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", end);
          document.removeEventListener("pointercancel", end);
          sheet.style.removeProperty("transition");
          // Closing leaves from where the finger let go (the fade-out plays there).
          if (next.type === "pointerup" && swipeShouldClose(next.clientY - start.y, next.timeStamp - start.t)) onClose();
          else sheet.style.removeProperty("translate");
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", end);
        document.addEventListener("pointercancel", end);
      },
    }),
    [onClose],
  );
  return enabled ? handlers : {};
}
