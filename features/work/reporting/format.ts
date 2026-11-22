import { formatNumber } from "@/server/work/custom-fields";
import type { ValueFormat } from "@/server/work/reporting";

// v1.67.0 (D-375): how dashboard figures read (shared by charts and tables).
export function formatValue(value: number | null | undefined, format: ValueFormat | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (!format || format.kind === "count") return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (format.kind === "hours") return `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;
  return formatNumber(value, format.config);
}
// Axis ticks: in full under 10,000; compact on an axis that reaches it (10K, 1.5L is avoided: K and M read everywhere).
export function tickText(value: number, max: number): string {
  if (Math.abs(max) < 10000) return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (Math.abs(max) < 1_000_000) return `${(value / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}K`;
  return `${(value / 1_000_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}M`;
}
export const shortLabel = (label: string, max = 14) => (label.length > max ? `${label.slice(0, max - 1)}…` : label);
export const seriesColor = (slot: number) => `var(--color-chart-${Math.min(8, Math.max(1, slot))})`;
