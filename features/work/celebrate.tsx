"use client";

import { createContext, useCallback, useContext } from "react";
import { shouldCelebrate, type Celebration } from "@/server/work/pm-rules";
import { MOTION_DURATION, MOTION_EASE, prefersReducedMotion } from "@/features/ui/motion";

// v1.62.0 (D-368, spec §14, DEC-011): finishing a task. An original check
// animation (the circle fills, the tick draws, a small spring pop: CSS in
// styles/globals.css, .pm-check*) and, by the person's choice (Off /
// Occasional / Always; Admin sets the default), a short burst of theme-coloured
// pieces from the tick. Never with prefers-reduced-motion. The layer is
// decorative (aria-hidden, no pointer events) and removes itself.
interface CelebrationState {
  enabled: boolean; // the "pm_foundations" switch is on for this person
  choice: Celebration;
}
const CelebrationContext = createContext<CelebrationState>({ enabled: false, choice: "OFF" });

export function CelebrationProvider({ enabled, choice, children }: CelebrationState & { children: React.ReactNode }) {
  return <CelebrationContext.Provider value={{ enabled, choice }}>{children}</CelebrationContext.Provider>;
}
export const useCelebrationState = () => useContext(CelebrationContext);

const reducedMotion = prefersReducedMotion;

// The burst: 14 pieces in the identity colours, flying out from `from`.
export function burst(from: { x: number; y: number }) {
  if (reducedMotion() || typeof document === "undefined") return;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.testid = "celebration";
  layer.className = "pm-celebration";
  document.body.appendChild(layer);
  const pieces = 14;
  const done: Promise<unknown>[] = [];
  for (let index = 0; index < pieces; index++) {
    const piece = document.createElement("span");
    piece.className = "pm-celebration-piece";
    piece.style.left = `${from.x}px`;
    piece.style.top = `${from.y}px`;
    piece.style.background = `var(--color-identity-${(index % 8) + 1})`;
    layer.appendChild(piece);
    const angle = (Math.PI * 2 * index) / pieces + Math.random() * 0.4;
    const distance = 28 + Math.random() * 30;
    const animation = piece.animate?.(
      [
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) rotate(${Math.round(Math.random() * 360)}deg) scale(0.6)`, opacity: 0 },
      ],
      { duration: MOTION_DURATION.emphasis * 2 + Math.random() * 180, easing: MOTION_EASE.enter, fill: "forwards" },
    );
    if (animation) done.push(animation.finished.catch(() => undefined));
  }
  // Always cleaned up, even if an animation never reports back.
  void Promise.race([Promise.all(done), new Promise((resolve) => setTimeout(resolve, MOTION_DURATION.emphasis * 4))]).then(() => layer.remove());
}

// Called after the server confirms a completion.
export function useCelebrate() {
  const { enabled, choice } = useCelebrationState();
  return useCallback(
    (element?: Element | null) => {
      if (!enabled || !shouldCelebrate(choice, reducedMotion(), Math.random())) return;
      const box = element?.getBoundingClientRect();
      burst(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 3 });
    },
    [enabled, choice],
  );
}
