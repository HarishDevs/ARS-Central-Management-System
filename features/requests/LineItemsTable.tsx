"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { SafeText } from "@/features/ui/SafeText";
import { sortRows, type SortDir } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): a request's line items, sortable by any column on the page
// (the rows are all here, nothing is paged). Click a title: ascending; again:
// descending. Values come formatted from the server, with the numbers to sort by.
export interface LineItemRow {
  description: string;
  quantity: number;
  quantityText: string;
  rate: number;
  rateText: string;
  gst: number;
  gstText: string;
  total: number;
  totalText: string;
}
type Column = "description" | "quantity" | "rate" | "gst" | "total";
const COLUMNS: { key: Column; label: string; right?: boolean }[] = [
  { key: "description", label: "Description" },
  { key: "quantity", label: "Qty", right: true },
  { key: "rate", label: "Rate", right: true },
  { key: "gst", label: "GST %", right: true },
  { key: "total", label: "Total", right: true },
];

export function LineItemsTable({ caption, rows }: { caption: string; rows: LineItemRow[] }) {
  const [sort, setSort] = useState<{ by: Column | null; dir: SortDir }>({ by: null, dir: "asc" });
  const shown = sort.by ? sortRows(rows, (row) => row[sort.by!], sort.dir) : rows;
  return (
    <table className="data-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {COLUMNS.map((column) => {
            const active = sort.by === column.key;
            const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
            const next: SortDir = active && sort.dir === "asc" ? "desc" : "asc";
            return (
              <th key={column.key} scope="col" className={column.right ? "text-right" : undefined} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} data-sort-column={column.key}>
                <button
                  type="button"
                  onClick={() => setSort({ by: column.key, dir: next })}
                  className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}
                  title={`Sort by ${column.label}, ${next === "asc" ? "ascending" : "descending"}`}
                  data-testid="sort-link"
                >
                  {column.label}
                  <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "opacity-40"}`} />
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {shown.map((line, index) => (
          <tr key={index}>
            <td>
              <SafeText text={line.description} />
            </td>
            <td className="text-right tabular-nums">{line.quantityText}</td>
            <td className="text-right tabular-nums">{line.rateText}</td>
            <td className="text-right tabular-nums">{line.gstText}</td>
            <td className="text-right tabular-nums">{line.totalText}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
