"use client";

import { useEffect, useRef } from "react";
import { MOTION_DURATION } from "@/features/ui/motion";

// v1.87.0 (D-417, motion brief: "dashboard cards animate only the values that
// changed"): a figure on a card. When the page's data is refreshed (the
// minute's quiet refresh, a change elsewhere) and this figure is different,
// it gets a short emphasis (globals.css [data-value-changed], 300 ms, none
// with reduced motion); figures that stayed the same don't move. Nothing
// happens on the first draw.
export function LiveNumber({ value, className, testId }: { value: number; className?: string; testId?: string }) {
  const span = useRef<HTMLSpanElement>(null);
  const last = useRef(value);
  useEffect(() => {
    const element = span.current;
    if (!element || last.current === value) return;
    last.current = value;
    element.removeAttribute("data-value-changed");
    void element.offsetWidth; // restart the animation for a second change in a row
    element.setAttribute("data-value-changed", "");
    const done = () => element.removeAttribute("data-value-changed");
    element.addEventListener("animationend", done, { once: true });
    const timer = window.setTimeout(done, MOTION_DURATION.emphasis * 2); // a fallback if animationend never comes
    return () => window.clearTimeout(timer);
  }, [value]);
  return (
    <span ref={span} className={className} data-testid={testId}>
      {value}
    </span>
  );
}
