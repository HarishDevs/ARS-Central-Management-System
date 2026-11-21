"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// v1.61.0 (D-366 "faster polling", D-367): no sockets on our hosting, so open
// work views stay fresh by asking the server again
//   - after every change (useWorkCall already refreshes),
//   - when the window gets focus back or the tab becomes visible,
//   - every 15 seconds while the page is visible (paused while hidden).
// Project views, My Tasks and the task pane share ONE timer per page however
// many of them are on screen. A refresh waits while the person is typing in a
// field or a dialog is open, so nothing they are doing is disturbed.
export const LIVE_REFRESH_MS = 15_000;
const FOCUS_GAP_MS = 2_000;

// Pure: should a tick refresh now? (unit-tested)
export function shouldRefresh(input: { visible: boolean; busy: boolean; now: number; last: number; every: number; force?: boolean }): boolean {
  if (!input.visible || input.busy) return false;
  if (input.force) return input.now - input.last >= FOCUS_GAP_MS;
  return input.now - input.last >= input.every - 500;
}

type Refresh = () => void;
const subscribers = new Set<{ refresh: Refresh }>();
let timer: number | null = null;
let last = 0;
let listening = false;

const busy = () => Boolean(document.querySelector("input:focus, textarea:focus, select:focus, [contenteditable='true']:focus, dialog[open]"));
function tick(force = false) {
  const now = Date.now();
  if (!shouldRefresh({ visible: document.visibilityState === "visible", busy: busy(), now, last, every: LIVE_REFRESH_MS, force })) return;
  last = now;
  // One refresh renders the whole page again (every subscriber's data).
  [...subscribers].at(-1)?.refresh();
}
function startTimer() {
  if (timer === null && document.visibilityState === "visible") timer = window.setInterval(() => tick(), LIVE_REFRESH_MS);
}
function stopTimer() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}
function onVisibility() {
  if (document.visibilityState === "visible") {
    tick(true);
    startTimer();
  } else stopTimer();
}
function onFocus() {
  tick(true);
}

export function useLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const me = { refresh: () => router.refresh() };
    subscribers.add(me);
    if (!listening) {
      listening = true;
      last = Date.now();
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("focus", onFocus);
    }
    startTimer();
    return () => {
      subscribers.delete(me);
      if (subscribers.size === 0) {
        stopTimer();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("focus", onFocus);
        listening = false;
      }
    };
  }, [router]);
}

// For server-rendered views (Calendar, Timeline, Overview, the task pane).
export function LiveRefresh() {
  useLiveRefresh();
  return null;
}
