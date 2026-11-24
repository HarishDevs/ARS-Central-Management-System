"use client";

import { useEffect, useState } from "react";
import { formatDate, formatDateTime, formatDayTime, formatRelative, formatRelativeDay, toMillis, type DateInput } from "@/lib/format/date";

// v1.89.0 (D-425, UIQA-ERR-01): relative time text ("2 h ago", "Yesterday", "Today at
// 2:27 pm") depends on "now", which differs between the server's render and the
// browser's hydration: a text mismatch is React error #418. The server and the first
// paint show the ABSOLUTE text (the same everywhere); after mount the browser swaps in
// the relative text and refreshes it every minute. Both texts sit in one grid cell, so
// the element keeps the wider of the two and nothing around it moves (no layout shift).
// The absolute text stays the tooltip and the accessible name of <time>.

type Kind = "moment" | "day" | "daytime";

function relativeText(kind: Kind, at: DateInput, now: number): string {
  if (kind === "day") return formatRelativeDay(at, now);
  if (kind === "daytime") return formatDayTime(at, now);
  return formatRelative(at, now);
}

export function RelativeTime({
  at,
  kind = "moment",
  className,
  align = "start",
  testId,
}: {
  at: DateInput;
  /** "moment": 2 h ago · "day": Today / Tomorrow / 24 Nov · "daytime": Today at 2:27 pm */
  kind?: Kind;
  className?: string;
  /** "end" when the text is right-aligned (table cells, row ends). */
  align?: "start" | "end";
  testId?: string;
}) {
  const ms = toMillis(at);
  const absolute = kind === "day" ? formatDate(at) : formatDateTime(at);
  const [relative, setRelative] = useState<string | null>(null);

  useEffect(() => {
    if (ms === null) return;
    const update = () => setRelative(relativeText(kind, at, Date.now()));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the moment, not the input object
  }, [ms, kind]);

  if (ms === null) return null;
  const iso = typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : new Date(ms).toISOString();
  return (
    <time
      dateTime={iso}
      title={absolute}
      data-testid={testId}
      data-relative={relative === null ? "pending" : "ready"}
      className={`inline-grid ${align === "end" ? "justify-items-end" : "justify-items-start"} ${className ?? ""}`}
    >
      <span className={`[grid-area:1/1] whitespace-nowrap ${relative === null ? "" : "invisible"}`} aria-hidden={relative === null ? undefined : true}>
        {absolute}
      </span>
      {relative !== null && <span className="[grid-area:1/1] whitespace-nowrap">{relative}</span>}
    </time>
  );
}
