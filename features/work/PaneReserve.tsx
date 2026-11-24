"use client";

import { useEffect, useState } from "react";

// v1.89.0 (D-424, UIQA-PERF-02): a page loaded with ?task=<id> draws the screen
// before the browser has read the side pane (the @pane slot comes after the
// screen in the page), so the screen was first laid out full width and then
// narrowed: the Task Summary header wrapped and the list jumped 44 px (CLS
// 0.2-0.44 at 1440). This marker comes before the screen and makes the same
// room (globals.css, [data-pane-reserve]) with the person's pane width; once
// the page is live the real pane holds the room and the marker goes.
export function PaneReserve({ width }: { width: number }) {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(false), []);
  if (!on) return null;
  return (
    <>
      <style>{`:root{--pane-w:${width}px}`}</style>
      <span data-pane-reserve hidden />
    </>
  );
}
