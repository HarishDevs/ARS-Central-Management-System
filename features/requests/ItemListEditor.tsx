"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

// v1.57.0 (D-335, owner: "a stationary items list with qty request box so
// that the admin can confirm what are all provided"): the requester lists the
// items and the quantity of each (no rate, no GST). The server checks the rows
// again (parseItemRows); whoever handles it ticks each one when provided.
const MAX_ROWS = 100;
type Row = { description: string; quantity: string };
const blank = (): Row => ({ description: "", quantity: "1" });

function initialRows(value: string): Row[] {
  try {
    const parsed = JSON.parse(value) as { description?: unknown; quantity?: unknown }[];
    if (Array.isArray(parsed) && parsed.length) return parsed.map((row) => ({ description: String(row.description ?? ""), quantity: String(row.quantity ?? "1") }));
  } catch {
    // a fresh form
  }
  return [blank()];
}

export function ItemListEditor({ name, label, defaultValue, invalid, describedBy }: { name: string; label: string; defaultValue: string; invalid?: boolean; describedBy?: string }) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(defaultValue));
  const json = JSON.stringify(rows.filter((row) => row.description.trim()).map((row) => ({ description: row.description.trim(), quantity: row.quantity.trim() })));
  const set = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const total = rows.filter((row) => row.description.trim()).reduce((sum, row) => sum + (/^\d{1,6}$/.test(row.quantity.trim()) ? Number(row.quantity) : 0), 0);
  return (
    <div className={`rounded-md border ${invalid ? "border-danger-600" : "border-line"}`} aria-describedby={describedBy} data-testid={`item-list-${name}`}>
      <input type="hidden" name={name} value={json} />
      <div className="hidden gap-2 border-b border-line px-3 py-2 text-caption font-semibold text-ink-faint sm:grid sm:grid-cols-[2.5rem_1fr_7rem_2rem]">
        <span>#</span>
        <span>Item</span>
        <span>Qty needed</span>
        <span />
      </div>
      <ol className="divide-y divide-line" aria-label={`${label} items`}>
        {rows.map((row, index) => (
          <li key={index} className="grid grid-cols-[2rem_1fr_6rem_2rem] items-center gap-2 px-3 py-2 sm:grid-cols-[2.5rem_1fr_7rem_2rem]">
            <span className="text-label tabular-nums text-ink-muted">{index + 1}</span>
            <input aria-label={`Item ${index + 1}`} value={row.description} onChange={(event) => set(index, { description: event.target.value })} maxLength={200} className="field-input" placeholder="e.g. A4 paper (ream)" />
            <input aria-label={`Item ${index + 1} quantity`} value={row.quantity} onChange={(event) => set(index, { quantity: event.target.value.replace(/[^\d]/g, "").slice(0, 6) })} inputMode="numeric" className="field-input" />
            <button type="button" onClick={() => setRows((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : [blank()]))} aria-label={`Remove item ${index + 1}`} className="btn-ghost justify-self-end !px-2">
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
        <button type="button" disabled={rows.length >= MAX_ROWS} onClick={() => setRows((current) => [...current, blank()])} className="btn-ghost">
          <Plus aria-hidden="true" className="h-4 w-4" />
          Add an item
        </button>
        <p className="text-label">
          {rows.filter((row) => row.description.trim()).length} item(s) · total quantity <span className="font-semibold tabular-nums">{total.toLocaleString("en-IN")}</span>
        </p>
      </div>
    </div>
  );
}
