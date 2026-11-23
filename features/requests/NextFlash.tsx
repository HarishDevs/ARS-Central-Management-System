"use client";

import { useEffect, useRef } from "react";
import { rememberQueueOpen } from "@/features/requests/next-waiting";
import { MOTION_DELAY } from "@/features/ui/motion";

// v1.80.0 (D-407, point 13): a short highlight (1.6 s) around what just
// arrived, e.g. "Next waiting for you" after a decision. Only a colour change.
export const FLASH_MS = MOTION_DELAY.highlight;

// `continueFlow`: this request is the next in the "Next waiting for you" flow.
export function NextFlash({ children, continueFlow }: { children: React.ReactNode; continueFlow?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (continueFlow) rememberQueueOpen(continueFlow);
  }, [continueFlow]);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.setAttribute("data-next-flash", "");
    const timer = window.setTimeout(() => element.removeAttribute("data-next-flash"), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div ref={box} className="rounded-md">
      {children}
    </div>
  );
}
