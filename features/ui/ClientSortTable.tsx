"use client";

import { isValidElement, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

// v1.58.0 (D-351, owner: sorting "in all columns in all tables"): a summary
// table whose rows are already on the page (analytics boards, reports): click a
// column title to sort A→Z, again for Z→A. The value sorted is the cell's own
// number or text (₹, commas and % ignored; "3 days" and "5 h" compared as hours;
// "—" and empty cells last). The first column is the row's name.
export function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

export function sortValueOf(node: React.ReactNode): string | number | null {
  const text = textOf(node).trim();
  if (!text || text === "—" || text === "-" || text === "·") return null;
  const hours = /^(-?[\d,]+(?:\.\d+)?)\s*(h|hours?|days?|min)\b/i.exec(text);
  if (hours) {
    const value = Number(hours[1]!.replace(/,/g, ""));
    const unit = hours[2]!.toLowerCase();
    return unit.startsWith("d") ? value * 24 : unit === "min" ? value / 60 : value;
  }
  const number = /^[₹\s]*(-?[\d,]+(?:\.\d+)?)\s*(%|\/\s*5)?$/.exec(text);
  if (number) return Number(number[1]!.replace(/,/g, ""));
  return text.toLowerCase();
}

export function compareCells(a: string | number | null, b: string | number | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en-IN", { numeric: true, sensitivity: "base" });
}

export function ClientSortTable({ caption, head, rows, testid, minWidth = "min-w-[640px]", empty = "Nothing for this selection." }: { caption: string; head: string[]; rows: React.ReactNode[][]; testid?: string; minWidth?: string; empty?: string }) {
  const [sort, setSort] = useState<{ column: number; dir: "asc" | "desc" } | null>(null);
  const shown = useMemo(() => {
    if (!sort) return rows.map((row, index) => ({ row, index }));
    return rows
      .map((row, index) => ({ row, index, value: sortValueOf(row[sort.column]) }))
      .sort((a, b) => {
        if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
        const compared = compareCells(a.value, b.value);
        return (sort.dir === "desc" ? -compared : compared) || a.index - b.index;
      });
  }, [rows, sort]);
  return (
    <div className="card overflow-x-auto">
      <table className={`w-full ${minWidth} text-label`} data-testid={testid}>
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-caption text-ink-muted">
          <tr>
            {head.map((cell, index) => {
              const active = sort?.column === index;
              const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              const next = active && sort!.dir === "asc" ? "desc" : "asc";
              return (
                <th key={cell + index} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 ${index > 0 ? "text-right" : ""}`}>
                  <button type="button" onClick={() => setSort({ column: index, dir: next })} className="inline-flex items-center gap-1 hover:text-ink" title={`Sort by ${cell}, ${next === "asc" ? "ascending" : "descending"}`} data-testid="sort-link">
                    {cell}
                    <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${active ? "" : "opacity-40"}`} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-3 text-ink-muted">
                {empty}
              </td>
            </tr>
          ) : (
            shown.map(({ row, index }) => (
              <tr key={index}>
                {row.map((cell, column) =>
                  column === 0 ? (
                    <th key={column} scope="row" className="px-3 py-2 text-left font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={column} className="px-3 py-2 text-right tabular-nums">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
