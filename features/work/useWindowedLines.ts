"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeWindow, offsetOf, type WindowRange } from "@/server/work/tree";

// v1.61.0 (D-367, spec PRJ-03 "List at 1,500+ rows"): our own windowing. A long
// table draws only the lines near the screen (plus some either side) and keeps
// the page's full height with two spacers, so scrolling, the scrollbar and
// Ctrl+End behave as if every line were there. Heights are measured as lines
// draw (an estimate until then). Short tables draw everything.
export const WINDOW_FROM = 150; // lines; below this the whole table is drawn
const OVERSCAN = 12;

export function useWindowedLines(keys: readonly string[], estimate: (index: number) => number, enabled: boolean) {
  const container = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState({ scrollTop: 0, viewport: 1000 });
  const frame = useRef<number | null>(null);
  const bump = useRef<number | null>(null);

  const read = useCallback(() => {
    frame.current = null;
    const box = container.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const next = { scrollTop: Math.max(0, -rect.top), viewport: window.innerHeight };
    setView((value) => (Math.abs(value.scrollTop - next.scrollTop) < 4 && value.viewport === next.viewport ? value : next));
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const onScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(read);
    };
    read();
    // Capture: any scrolling ancestor (or the page) moves the table.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [enabled, read]);
  useLayoutEffect(() => {
    if (enabled) read();
  }, [enabled, read, keys.length]);

  const sizes = useMemo(
    () => keys.map((key, index) => heights.current.get(key) ?? estimate(index)),
    // `version` re-reads measured heights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys, estimate, version],
  );
  const range: WindowRange = useMemo(
    () => (enabled ? computeWindow(sizes, view.scrollTop, view.viewport, OVERSCAN) : { start: 0, end: keys.length, padTop: 0, padBottom: 0, total: 0 }),
    [enabled, sizes, view, keys.length],
  );

  // A drawn line reports its height; a change re-plans the window once per frame.
  const measure = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (!enabled || !element) return;
      const height = element.offsetHeight;
      if (!height || Math.abs((heights.current.get(key) ?? -1) - height) < 1) return;
      heights.current.set(key, height);
      if (bump.current === null)
        bump.current = requestAnimationFrame(() => {
          bump.current = null;
          setVersion((value) => value + 1);
        });
    },
    [enabled],
  );

  // Bring line `index` on screen (keyboard Home/End/Page keys), then draw it.
  const scrollToIndex = useCallback(
    (index: number) => {
      const box = container.current;
      if (!box || !enabled) return;
      const rect = box.getBoundingClientRect();
      const lineTop = rect.top + offsetOf(sizes, index);
      const margin = 120;
      if (lineTop < margin) window.scrollBy({ top: lineTop - margin });
      else if (lineTop > window.innerHeight - margin) window.scrollBy({ top: lineTop - window.innerHeight / 2 });
      read();
    },
    [enabled, sizes, read],
  );

  return { container, range, measure, scrollToIndex };
}
