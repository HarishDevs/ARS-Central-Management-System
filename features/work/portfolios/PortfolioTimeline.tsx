"use client";

import { Briefcase, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { COLOR_HEX } from "@/features/work/client";
import { dayWords, StatusPill } from "@/features/work/portfolios/PortfolioList";
import { barPlacement, maskedName, quarterWindow, type PortfolioRow } from "@/server/work/portfolio-rules";

// v1.69.0 (D-382, spec PORTFOLIOS §3.17): Timeline by quarters. One bar per
// project (its start to due date) or sub-portfolio (its own dates, else the
// span of its projects the person can see). Keyboard: the rows are one tab
// stop; ↑/↓ (Home/End) move between rows, ←/→ show the previous or next
// quarter (announced), Enter opens the row. No animation.
const COUNT = 4;

export function PortfolioTimeline({ rows, today }: { rows: PortfolioRow[]; today: string }) {
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(0);
  const [live, setLive] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const quarters = quarterWindow(today, offset, COUNT);
  const first = quarters[0]!;
  const last = quarters[COUNT - 1]!;
  const todayAt = barPlacement(today, today, quarters);
  const shift = (by: number) => {
    const next = by === 0 ? 0 : offset + by;
    setOffset(next);
    const shown = quarterWindow(today, next, COUNT);
    setLive(`Showing ${shown[0]!.label} to ${shown[COUNT - 1]!.label}.`);
  };
  const focusRow = (index: number) => {
    const target = Math.max(0, Math.min(rows.length - 1, index));
    setActive(target);
    list.current?.querySelectorAll<HTMLElement>("[data-row-focus]")[target]?.focus();
  };
  return (
    <section aria-label="Timeline" data-testid="portfolio-timeline">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary btn-compact" aria-label="Previous quarter" onClick={() => shift(-1)}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={() => shift(0)}>
          Today
        </button>
        <button type="button" className="btn-secondary btn-compact" aria-label="Next quarter" onClick={() => shift(1)}>
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <span className="text-label text-ink-muted" data-testid="timeline-range">
          {first.label} – {last.label}
        </span>
        <span className="ml-auto text-caption text-ink-muted">Quarters · ↑ ↓ rows, ← → quarters</span>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
      {rows.length === 0 ? (
        <p className="card px-4 py-8 text-center text-label text-ink-muted">Nothing in this portfolio yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-[14rem_minmax(0,1fr)] border-b border-line text-caption text-ink-muted" aria-hidden="true">
              <div className="px-3 py-2">Name · Status</div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${COUNT}, minmax(0, 1fr))` }}>
                {quarters.map((quarter) => (
                  <div key={quarter.key} className="border-l border-line px-2 py-2">
                    <span className="font-semibold text-ink">{quarter.label}</span> <span>{quarter.months}</span>
                  </div>
                ))}
              </div>
            </div>
            <ul
              ref={list}
              aria-label={`Timeline from ${first.label} to ${last.label}`}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") focusRow(active + 1);
                else if (event.key === "ArrowUp") focusRow(active - 1);
                else if (event.key === "Home") focusRow(0);
                else if (event.key === "End") focusRow(rows.length - 1);
                else if (event.key === "ArrowLeft") shift(-1);
                else if (event.key === "ArrowRight") shift(1);
                else return;
                event.preventDefault();
              }}
              data-testid="timeline-rows"
            >
              {rows.map((row, index) => {
                const place = row.masked ? null : barPlacement(row.startOn, row.dueOn, quarters);
                const name = row.masked ? maskedName(row) : row.name;
                const dates = row.masked ? "no details" : row.startOn || row.dueOn ? `${dayWords(row.startOn ?? row.dueOn)} to ${dayWords(row.dueOn ?? row.startOn)}${place ? "" : ", outside the quarters shown"}` : "no dates";
                const label = `${name}: ${dates}`;
                const focusProps = {
                  tabIndex: index === active ? 0 : -1,
                  "data-row-focus": true,
                  onFocus: () => setActive(index),
                  "aria-label": label,
                  className: "block h-full w-full rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600",
                };
                return (
                  <li key={row.itemId} className="grid grid-cols-[14rem_minmax(0,1fr)] border-b border-line last:border-0" data-testid="timeline-row">
                    <div className="flex min-w-0 flex-col justify-center px-3 py-2">
                      {row.masked ? (
                        <span className="flex items-center gap-1.5 text-label text-ink-muted">
                          <Lock aria-hidden="true" className="h-3.5 w-3.5" /> {name}
                        </span>
                      ) : (
                        <>
                          <span className="flex items-center gap-1.5 truncate text-label font-medium">
                            {row.kind === "PORTFOLIO" && <Briefcase aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink-muted" />}
                            <span className="truncate">{name}</span>
                          </span>
                          <StatusPill status={row.status} />
                        </>
                      )}
                    </div>
                    <div className="relative h-14">
                      <div aria-hidden="true" className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${COUNT}, minmax(0, 1fr))` }}>
                        {quarters.map((quarter) => (
                          <div key={quarter.key} className="border-l border-line" />
                        ))}
                      </div>
                      {todayAt && <div aria-hidden="true" className="absolute inset-y-0 w-px bg-primary-600" style={{ left: `${todayAt.left}%` }} />}
                      <div className="absolute inset-1">
                        {row.masked ? (
                          <span {...focusProps} role="img" />
                        ) : (
                          <Link href={row.kind === "PROJECT" ? `/users/work/projects/${row.id}` : `/users/work/portfolios/${row.id}`} {...focusProps}>
                            {place ? (
                              <span
                                aria-hidden="true"
                                className={`absolute top-1/2 h-5 -translate-y-1/2 ${place.clippedStart ? "rounded-l-none" : "rounded-l"} ${place.clippedEnd ? "rounded-r-none" : "rounded-r"}`}
                                style={{ left: `${place.left}%`, width: `${place.width}%`, backgroundColor: COLOR_HEX[row.color] ?? COLOR_HEX.gray }}
                                data-testid="timeline-bar"
                              />
                            ) : (
                              <span aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-caption text-ink-muted">
                                {row.startOn || row.dueOn ? "Outside these quarters" : "No dates"}
                              </span>
                            )}
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
