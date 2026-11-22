"use client";

import { useId, useState } from "react";
import { CHART_STYLE_LABEL, niceTicks, shareOf, type ChartData } from "@/server/work/reporting";
import { formatValue, seriesColor, shortLabel, tickText } from "@/features/work/reporting/format";

// v1.67.0 (D-375, spec PV §7): one dashboard chart, drawn as our own SVG
// with theme tokens only (the validated --color-chart-N series colours; text
// in text tokens, never in a series colour). One Y-axis. Thin marks: bars at
// most 24 px with 4 px rounded data ends, a 2 px surface gap between touching
// marks, 2 px lines, markers with a surface ring. A legend for two or more
// series. Hover a column (or a slice), or focus the chart and use the arrow
// keys, to read every value in a tooltip (announced politely). "View as
// table" (the parent) swaps the picture for the same figures as a table.
const W = 640;
const H = 260;
const PAD = { top: 18, right: 16, bottom: 46, left: 52 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const LINE_STYLES = new Set(["line", "burnup", "burndown"]);

// A bar from the baseline (`from`) to its data end (`to`), rounded 4 px at the data end only.
function barPath(x: number, from: number, to: number, width: number): string {
  const height = Math.abs(from - to);
  if (height < 0.5) return "";
  const r = Math.min(4, width / 2, height);
  if (to <= from)
    return `M${x},${from} V${to + r} Q${x},${to} ${x + r},${to} H${x + width - r} Q${x + width},${to} ${x + width},${to + r} V${from} Z`;
  return `M${x},${from} V${to - r} Q${x},${to} ${x + r},${to} H${x + width - r} Q${x + width},${to} ${x + width},${to - r} V${from} Z`;
}
function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = Math.min(end - start, Math.PI * 2 - 0.0001);
  const finish = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const p = (radius: number, angle: number) => `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`;
  return `M${p(outer, start)} A${outer},${outer} 0 ${large} 1 ${p(outer, finish)} L${p(inner, finish)} A${inner},${inner} 0 ${large} 0 ${p(inner, start)} Z`;
}

export function ChartView({ data, title, table = false }: { data: ChartData; title: string; table?: boolean }) {
  if (data.style === "number")
    return (
      <p className="py-2 text-4xl font-semibold text-ink" data-testid="chart-number">
        {formatValue(data.total, data.formats[0])}
      </p>
    );
  if (table) return <ChartTable data={data} title={title} />;
  if (data.empty)
    return (
      <p className="flex min-h-40 items-center justify-center rounded-md bg-surface-muted px-4 py-8 text-center text-label text-ink-muted" data-testid="chart-empty">
        This chart will fill in as work happens.
      </p>
    );
  return data.style === "donut" ? <Donut data={data} title={title} /> : <AxisChart data={data} title={title} />;
}

function Legend({ items }: { items: { key: string; label: string; slot: number; line?: boolean; dashed?: boolean; extra?: string }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted" aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          {item.line ? (
            <svg width="18" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="17" y2="4" stroke={seriesColor(item.slot)} strokeWidth="2" strokeLinecap="round" strokeDasharray={item.dashed ? "4 3" : undefined} />
            </svg>
          ) : (
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: seriesColor(item.slot) }} />
          )}
          <span>
            {item.label}
            {item.extra ? <span className="text-ink-faint"> {item.extra}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The keyboard and pointer layer: one tab stop; ← / → (and Home / End) move
// between columns or slices; the tooltip follows; the live region reads it.
function useActive(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!count) return;
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key in keys) {
      event.preventDefault();
      setActive((current) => (current === null ? 0 : Math.min(count - 1, Math.max(0, current + keys[event.key]!))));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : count - 1);
    } else if (event.key === "Escape") setActive(null);
  };
  return { active, setActive, onKeyDown };
}

function readout(data: ChartData, index: number): { label: string; lines: { key: string; label: string; slot: number; value: string }[] } {
  const category = data.categories[index]!;
  if (data.style === "donut") {
    const value = data.values[0]?.[index] ?? null;
    return { label: category.label, lines: [{ key: "v", label: data.yLabel, slot: index + 1, value: `${formatValue(value, data.formats[0])} (${shareOf(data.values[0] ?? [], index)}%)` }] };
  }
  return { label: category.label, lines: data.series.map((series, s) => ({ key: series.key, label: series.label, slot: series.slot, value: formatValue(data.values[s]?.[index] ?? null, data.formats[s]) })) };
}

function Tooltip({ data, index, leftPct }: { data: ChartData; index: number; leftPct: number }) {
  const info = readout(data, index);
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute top-1 z-10 min-w-36 max-w-60 -translate-x-1/2 rounded-md border border-line bg-raised px-3 py-2 text-caption shadow-overlay"
      style={{ left: `${Math.min(85, Math.max(15, leftPct))}%` }}
      data-testid="chart-tooltip"
    >
      <p className="mb-1 font-semibold text-ink">{info.label}</p>
      <ul className="space-y-0.5">
        {info.lines.map((line) => (
          <li key={line.key} className="flex items-center justify-between gap-3 text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-sm" style={{ background: seriesColor(line.slot) }} />
              {line.label}
            </span>
            <span className="tabular-nums text-ink">{line.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
const liveText = (data: ChartData, index: number | null) => {
  if (index === null) return "";
  const info = readout(data, index);
  return `${info.label}: ${info.lines.map((line) => `${data.series.length > 1 || data.style === "donut" ? `${line.label} ` : ""}${line.value}`).join(", ")}. ${index + 1} of ${data.categories.length}.`;
};

function AxisChart({ data, title }: { data: ChartData; title: string }) {
  const hint = useId();
  const n = data.categories.length;
  const { active, setActive, onKeyDown } = useActive(n);
  const stacked = data.style === "stacked";
  const grouped = data.style === "grouped";
  const lines = LINE_STYLES.has(data.style);
  const nums = data.values.map((list) => list.map((value) => value ?? 0));
  const totals = data.categories.map((_, c) => nums.reduce((sum, list) => sum + Math.max(0, list[c] ?? 0), 0));
  const all = stacked ? totals : nums.flat();
  const ticks = niceTicks(Math.min(0, ...all, data.benchmark ?? 0), Math.max(1, ...all, data.benchmark ?? 0));
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const y = (value: number) => PAD.top + (1 - (value - lo) / (hi - lo || 1)) * PLOT_H;
  const base = y(Math.max(lo, 0));
  const band = PLOT_W / Math.max(1, n);
  const cx = (index: number) => PAD.left + band * (index + 0.5);
  const k = data.series.length;
  const barW = grouped ? Math.max(2, Math.min(24, (band * 0.8 - 2 * (k - 1)) / k)) : Math.max(2, Math.min(24, band * 0.6));
  const every = Math.max(1, Math.ceil(n / (lines ? 8 : 12)));
  const labelValues = data.dataLabels && n <= (grouped ? 10 : 24);
  const legend = data.series.length >= 2;
  const max = Math.max(Math.abs(lo), Math.abs(hi));
  return (
    <div>
      {legend && <Legend items={data.series.map((series) => ({ key: series.key, label: series.label, slot: series.slot, line: lines, dashed: series.dashed }))} />}
      <div className="relative">
        <div
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`${title}. ${CHART_STYLE_LABEL[data.style]} chart of ${data.yLabel} by ${data.xLabel}, ${n} ${n === 1 ? "point" : "points"}.`}
          aria-describedby={hint}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((current) => current ?? 0)}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          data-testid="chart-plot"
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border-default)" strokeWidth="1" />
                <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-secondary)" className="tabular-nums">
                  {tickText(tick, max)}
                </text>
              </g>
            ))}
            <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="var(--color-border-strong)" strokeWidth="1" />
            {data.categories.map((category, index) =>
              index % every === 0 || index === n - 1 ? (
                <text key={category.key} x={cx(index)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--color-text-secondary)">
                  {shortLabel(category.label, n > 8 ? 9 : 14)}
                </text>
              ) : null,
            )}
            <text x={PAD.left + PLOT_W / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-text-placeholder)">
              {data.xLabel}
            </text>
            {active !== null && <rect x={PAD.left + band * active} y={PAD.top} width={band} height={PLOT_H} fill="var(--color-surface-muted)" opacity="0.7" />}
            {/* Marks */}
            {!lines &&
              data.categories.map((category, c) => {
                if (stacked) {
                  let level = 0;
                  return (
                    <g key={category.key}>
                      {data.series.map((series, s) => {
                        const value = Math.max(0, nums[s]![c] ?? 0);
                        if (!value) return null;
                        const from = y(level);
                        level += value;
                        const isTop = !data.series.slice(s + 1).some((_, later) => (nums[s + 1 + later]![c] ?? 0) > 0);
                        // A 2 px surface gap between touching segments.
                        const to = y(level) + (isTop ? 0 : 1);
                        const bottom = level - value > 0 ? from - 1 : from;
                        return isTop ? <path key={series.key} d={barPath(cx(c) - barW / 2, bottom, to, barW)} fill={seriesColor(series.slot)} /> : <rect key={series.key} x={cx(c) - barW / 2} y={to} width={barW} height={Math.max(0, bottom - to)} fill={seriesColor(series.slot)} />;
                      })}
                      {labelValues && totals[c]! > 0 && (
                        <text x={cx(c)} y={y(totals[c]!) - 5} textAnchor="middle" fontSize="11" fill="var(--color-text-primary)" className="tabular-nums">
                          {formatValue(totals[c]!, data.formats[0])}
                        </text>
                      )}
                    </g>
                  );
                }
                return (
                  <g key={category.key}>
                    {data.series.map((series, s) => {
                      const value = nums[s]![c] ?? 0;
                      const left = grouped ? cx(c) - (k * barW + 2 * (k - 1)) / 2 + s * (barW + 2) : cx(c) - barW / 2;
                      const mid = left + barW / 2;
                      if (data.style === "lollipop") {
                        return (
                          <g key={series.key}>
                            <line x1={mid} x2={mid} y1={base} y2={y(value)} stroke={seriesColor(series.slot)} strokeWidth="2" />
                            <circle cx={mid} cy={y(value)} r="5" fill={seriesColor(series.slot)} stroke="var(--color-surface-raised)" strokeWidth="2" />
                          </g>
                        );
                      }
                      return <path key={series.key} d={barPath(left, base, y(value), barW)} fill={seriesColor(series.slot)} />;
                    })}
                    {labelValues &&
                      data.series.map((series, s) => {
                        const value = data.values[s]![c];
                        if (value === null || value === undefined || (!value && !grouped)) return null;
                        const left = grouped ? cx(c) - (k * barW + 2 * (k - 1)) / 2 + s * (barW + 2) : cx(c) - barW / 2;
                        return (
                          <text key={series.key} x={left + barW / 2} y={value >= 0 ? y(value) - (data.style === "lollipop" ? 10 : 5) : y(value) + 14} textAnchor="middle" fontSize={grouped ? 10 : 11} fill="var(--color-text-primary)" className="tabular-nums">
                            {formatValue(value, data.formats[s])}
                          </text>
                        );
                      })}
                  </g>
                );
              })}
            {lines &&
              data.series.map((series, s) => {
                const points = nums[s]!.map((value, index) => `${cx(index)},${y(value)}`).join(" ");
                const last = n - 1;
                return (
                  <g key={series.key}>
                    <polyline points={points} fill="none" stroke={seriesColor(series.slot)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={series.dashed ? "6 4" : undefined} />
                    {n <= 31 && !series.dashed && nums[s]!.map((value, index) => <circle key={index} cx={cx(index)} cy={y(value)} r="4" fill={seriesColor(series.slot)} stroke="var(--color-surface-raised)" strokeWidth="2" />)}
                    {active !== null && <circle cx={cx(active)} cy={y(nums[s]![active] ?? 0)} r="5" fill={seriesColor(series.slot)} stroke="var(--color-surface-raised)" strokeWidth="2" />}
                    {data.dataLabels && last >= 0 && !series.dashed && (
                      <text x={Math.min(cx(last), W - PAD.right - 2)} y={y(nums[s]![last] ?? 0) - 8} textAnchor="end" fontSize="11" fill="var(--color-text-primary)" className="tabular-nums">
                        {formatValue(data.values[s]![last] ?? 0, data.formats[s])}
                      </text>
                    )}
                  </g>
                );
              })}
            {data.benchmark !== null && (
              <g data-testid="chart-benchmark">
                <line x1={PAD.left} x2={W - PAD.right} y1={y(data.benchmark)} y2={y(data.benchmark)} stroke="var(--color-text-secondary)" strokeWidth="1.5" />
                <text x={W - PAD.right} y={y(data.benchmark) - 4} textAnchor="end" fontSize="11" fill="var(--color-text-secondary)">
                  Benchmark {formatValue(data.benchmark, data.formats[0])}
                </text>
              </g>
            )}
            {/* Hit targets: a whole column each, bigger than the marks. */}
            {data.categories.map((category, index) => (
              <rect key={category.key} x={PAD.left + band * index} y={PAD.top} width={band} height={PLOT_H + 20} fill="transparent" onPointerEnter={() => setActive(index)} onPointerDown={() => setActive(index)} />
            ))}
          </svg>
        </div>
        {active !== null && active < n && <Tooltip data={data} index={active} leftPct={(cx(active) / W) * 100} />}
      </div>
      <p id={hint} className="sr-only">
        Use the left and right arrow keys to read each value; View as table shows every figure.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {liveText(data, active)}
      </p>
      {data.note && <p className="mt-1 text-caption text-ink-muted">{data.note}</p>}
    </div>
  );
}

function Donut({ data, title }: { data: ChartData; title: string }) {
  const hint = useId();
  const values = (data.values[0] ?? []).map((value) => Math.max(0, value ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const { active, setActive, onKeyDown } = useActive(values.length);
  const size = 220;
  const c = size / 2;
  let angle = 0;
  const slices = values.map((value, index) => {
    const start = angle;
    angle += total ? (value / total) * Math.PI * 2 : 0;
    return { index, start, end: angle, value };
  });
  return (
    <div>
      <Legend items={data.categories.map((category, index) => ({ key: category.key, label: category.label, slot: index + 1, extra: data.dataLabels ? (data.percent ? `${shareOf(values, index)}%` : formatValue(values[index]!, data.formats[0])) : undefined }))} />
      <div className="relative mx-auto max-w-[260px]">
        <div
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={`${title}. Donut chart of ${data.yLabel} by ${data.xLabel}, ${values.length} parts, ${formatValue(total, data.formats[0])} in all.`}
          aria-describedby={hint}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((current) => current ?? 0)}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          data-testid="chart-plot"
        >
          <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" aria-hidden="true">
            {slices.map((slice) =>
              slice.value > 0 ? (
                <path
                  key={slice.index}
                  d={arcPath(c, c, active === slice.index ? 102 : 96, 60, slice.start, slice.end)}
                  fill={seriesColor(slice.index + 1)}
                  stroke="var(--color-surface-raised)"
                  strokeWidth="2"
                  onPointerEnter={() => setActive(slice.index)}
                  onPointerDown={() => setActive(slice.index)}
                />
              ) : null,
            )}
            <text x={c} y={c - 2} textAnchor="middle" fontSize="26" fontWeight="600" fill="var(--color-text-primary)">
              {formatValue(total, data.formats[0])}
            </text>
            <text x={c} y={c + 18} textAnchor="middle" fontSize="11" fill="var(--color-text-secondary)">
              {data.yLabel}
            </text>
          </svg>
        </div>
        {active !== null && active < values.length && <Tooltip data={data} index={active} leftPct={50} />}
      </div>
      <p id={hint} className="sr-only">
        Use the arrow keys to read each part; View as table shows every figure.
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {liveText(data, active)}
      </p>
      {data.note && <p className="mt-1 text-caption text-ink-muted">{data.note}</p>}
    </div>
  );
}

// The same figures as a table (every chart has one).
export function ChartTable({ data, title }: { data: ChartData; title: string }) {
  if (data.style === "number")
    return (
      <table className="data-table">
        <caption className="sr-only">{title}</caption>
        <tbody>
          <tr>
            <th scope="row">{data.yLabel}</th>
            <td className="text-right tabular-nums">{formatValue(data.total, data.formats[0])}</td>
          </tr>
        </tbody>
      </table>
    );
  const donut = data.style === "donut";
  return (
    <div className="max-h-80 overflow-auto" data-testid="chart-table">
      <table className="data-table">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <th scope="col">{data.xLabel || "Group"}</th>
            {data.series.length && !donut ? (
              data.series.map((series) => (
                <th key={series.key} scope="col" className="text-right">
                  {series.label}
                </th>
              ))
            ) : (
              <th scope="col" className="text-right">
                {data.yLabel}
              </th>
            )}
            {donut && (
              <th scope="col" className="text-right">
                Share
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {data.categories.map((category, c) => (
            <tr key={category.key}>
              <th scope="row" className="font-normal">
                {category.label}
              </th>
              {(donut ? [data.series[0]!] : data.series).map((series, s) => (
                <td key={series?.key ?? s} className="text-right tabular-nums">
                  {formatValue(data.values[s]?.[c] ?? null, data.formats[s])}
                </td>
              ))}
              {donut && <td className="text-right tabular-nums">{shareOf(data.values[0] ?? [], c)}%</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {data.categories.length === 0 && <p className="py-3 text-center text-label text-ink-muted">No figures yet.</p>}
      {data.note && <p className="mt-1 text-caption text-ink-muted">{data.note}</p>}
    </div>
  );
}
