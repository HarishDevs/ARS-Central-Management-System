// v1.89.0 (D-420): the owner's motion tokens for code. The values are the
// same as the CSS variables in styles/globals.css (:root, "motion scale");
// tests/ui/motion-tokens-v189.test.ts reads that file and fails when the two
// differ. CSS is the source for everything drawn by the browser; this file
// is for code that waits for a motion to end or sets one inline (WAAPI).
// Durations in milliseconds.

export const MOTION_DURATION = {
  instant: 100,
  fast: 150,
  standard: 200,
  smooth: 250,
  emphasis: 300,
} as const;
export type MotionToken = keyof typeof MOTION_DURATION;

export const MOTION_EASE = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  enter: "cubic-bezier(0, 0, 0.2, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  linear: "linear",
} as const;
export type MotionEase = keyof typeof MOTION_EASE;

export const MOTION_DISTANCE = { 1: 2, 2: 4, 3: 8, 4: 16, 5: 24, 6: 32 } as const;

// Delays, not durations: a tooltip waits before it shows; a loader, skeleton
// or progress bar shows only when the wait is longer than `loader`; a page
// that takes longer than `slowPage` simply appears (no page transition);
// a list's stagger step; a row highlight stays this long.
export const MOTION_DELAY = {
  tooltip: 300,
  loader: 150,
  slowPage: 300,
  staggerStep: 30,
  highlight: 1600,
} as const;

// Where each part of the app takes its timing from (D-420; the CSS role
// variables --motion-hover, --motion-menu, --motion-dialog-in, … are the same map).
export const MOTION_ROLE = {
  hover: "instant",
  press: "instant",
  menu: "fast",
  dropdown: "fast",
  tooltip: "fast",
  dialogIn: "smooth",
  dialogOut: "fast",
  drawerIn: "smooth",
  drawerOut: "fast",
  pane: "smooth",
  sheet: "smooth",
  page: "standard",
  pageOut: "fast",
  toastIn: "standard",
  toastOut: "fast",
  expand: "standard",
  newItem: "standard",
  emphasis: "emphasis",
  hero: "emphasis",
  reduced: "instant",
} as const satisfies Record<string, MotionToken>;
export type MotionRole = keyof typeof MOTION_ROLE;

/** The duration of a role in ms; 0 when the person asked for reduced motion. */
export function motionMs(role: MotionRole, reduced = false): number {
  return reduced ? 0 : MOTION_DURATION[MOTION_ROLE[role]];
}

/** True in a browser whose person asked for reduced motion (false on the server). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The scroll behaviour to use: smooth, unless reduced motion was asked for. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Waits for a role's motion to end (at once with reduced motion). */
export function afterMotion(role: MotionRole, then: () => void): () => void {
  const ms = motionMs(role, prefersReducedMotion());
  if (ms === 0) {
    then();
    return () => undefined;
  }
  const timer = setTimeout(then, ms);
  return () => clearTimeout(timer);
}
