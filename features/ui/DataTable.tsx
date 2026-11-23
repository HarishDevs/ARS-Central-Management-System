"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Rows3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/features/ui/Display";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortLink } from "@/features/ui/SortTh";
import type { SortDir } from "@/server/lists/sorting";

// UI-05 shared table. Rows come from the server already filtered by access;
// this only sorts what it was given, hides optional columns and changes
// density. Sticky header; real table semantics (caption, th scope,
// aria-sort); scrolls sideways inside its card on narrow screens, with the
// first column kept in view.
export interface Column {
  key: string;
  header: string;
  numeric?: boolean;
  sortable?: boolean;
  optional?: boolean; // can be hidden from the Columns menu
}

export interface Row {
  id: string | number;
  cells: Record<string, React.ReactNode>;
  sort?: Record<string, string | number | null>;
}

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa
// in all columns"): a table whose rows are paged by the server sorts on the
// server: `serverSort` gives the active column and, per column, the address
// of its next direction (links, so the sort is in the address and can be saved
// as a view). Without it the table sorts the rows it was given (both ways).
export interface ServerSort {
  sortBy: string | null;
  dir: SortDir;
  hrefs: Record<string, string>;
}

// v1.58.0 (D-354): Group by. Each group folds (all folded at first) with
// Expand all / Collapse all; rows not named in any group are left out.
export interface RowGroupIds {
  key: string;
  label: string;
  ids: (string | number)[];
}

type Density = "comfortable" | "compact";
const PAGE_SIZE = 25;

function readDensity(storageKey: string): Density {
  try {
    return localStorage.getItem(`ars.table.${storageKey}.density`) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function DataTable({
  caption,
  columns,
  rows,
  empty,
  storageKey,
  initialSort,
  stickyFirst = true,
  serverSort,
  groups,
}: {
  caption: string;
  columns: Column[];
  rows: Row[];
  empty: { title: string; body?: string; action?: React.ReactNode };
  storageKey: string;
  initialSort?: { key: string; direction: "asc" | "desc" };
  stickyFirst?: boolean;
  serverSort?: ServerSort;
  groups?: RowGroupIds[] | null;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<Density>("comfortable");
  const [columnsOpen, setColumnsOpen] = useState(false);
  // D-258: rows come in pages, so a long table never makes a long page.
  const [page, setPage] = useState(1);
  useEffect(() => setDensity(readDensity(storageKey)), [storageKey]);
  useEffect(() => setPage(1), [rows, sort]);

  const shown = columns.filter((column) => !hidden.has(column.key));
  const sorted = useMemo(() => {
    if (!sort || serverSort) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = a.sort?.[sort.key] ?? null;
      const right = b.sort?.[sort.key] ?? null;
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      return (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "en-IN", { numeric: true })) * factor;
    });
  }, [rows, sort, serverSort]);

  const toggleDensity = () => {
    const next = density === "compact" ? "comfortable" : "compact";
    setDensity(next);
    try {
      localStorage.setItem(`ars.table.${storageKey}.density`, next);
    } catch {
      // private mode: the choice lasts for this page only
    }
  };

  if (rows.length === 0) return <EmptyState title={empty.title} body={empty.body} action={empty.action} />;
  const pad = density === "compact" ? "py-1.5" : "py-3";
  // Grouped: every row on one page, inside its group.
  const pages = groups ? 1 : Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = groups ? sorted : sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const byId = new Map(sorted.map((row) => [String(row.id), row]));
  const renderRow = (row: Row) => (
    <tr key={row.id}>
      {shown.map((column, index) => {
        const Tag = index === 0 ? "th" : "td";
        return (
          <Tag
            key={column.key}
            scope={index === 0 ? "row" : undefined}
            data-label={index === 0 ? undefined : column.header}
            className={`${pad} ${column.numeric ? "text-right tabular-nums" : ""} ${index === 0 ? `border-b border-line px-4 text-left align-top font-normal ${stickyFirst ? "sticky left-0 bg-surface" : ""}` : ""}`}
          >
            {row.cells[column.key] ?? "—"}
          </Tag>
        );
      })}
    </tr>
  );
  const optional = columns.filter((column) => column.optional);
  return (
    <div className="card table-cards">
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line px-3 py-2 text-label">
        <span className="mr-auto px-2 text-ink-muted">{rows.length.toLocaleString("en-IN")} {rows.length === 1 ? "row" : "rows"}</span>
        {optional.length > 0 && (
          <div className="relative">
            <button type="button" className="btn-ghost btn-compact" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((value) => !value)}>
              <Columns3 aria-hidden="true" className="h-4 w-4" />
              Columns
            </button>
            {columnsOpen && (
              <fieldset className="absolute right-0 z-popover mt-1 w-56 space-y-1 rounded-md border border-line bg-raised p-2 shadow-overlay">
                <legend className="sr-only">Columns to show</legend>
                {optional.map((column) => (
                  <label key={column.key} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      checked={!hidden.has(column.key)}
                      onChange={() =>
                        setHidden((current) => {
                          const next = new Set(current);
                          if (next.has(column.key)) next.delete(column.key);
                          else next.add(column.key);
                          return next;
                        })
                      }
                    />
                    {column.header}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
        <button type="button" className="btn-ghost btn-compact" onClick={toggleDensity} aria-pressed={density === "compact"}>
          <Rows3 aria-hidden="true" className="h-4 w-4" />
          {density === "compact" ? "Comfortable" : "Compact"}
        </button>
      </div>
      <FoldScope enabled={Boolean(groups)} testId="table-fold-all">
      <div className="max-h-[70vh] overflow-auto" data-table-scroll>
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-[1] bg-surface">
            <tr>
              {shown.map((column, index) => {
                const serverHref = serverSort?.hrefs[column.key];
                if (serverSort) {
                  const serverActive = serverSort.sortBy === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={serverHref ? (serverActive ? (serverSort.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                      data-sort-column={serverHref ? column.key : undefined}
                      className={`${column.numeric ? "text-right" : ""} ${index === 0 && stickyFirst ? "sticky left-0 z-[2] bg-surface" : ""}`}
                    >
                      {serverHref ? <SortLink label={column.header} active={serverActive} dir={serverSort.dir} href={serverHref} /> : column.header}
                    </th>
                  );
                }
                const active = sort?.key === column.key;
                const ariaSort = active ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortable ? (ariaSort ?? "none") : undefined}
                    className={`${column.numeric ? "text-right" : ""} ${index === 0 && stickyFirst ? "sticky left-0 z-[2] bg-surface" : ""}`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 hover:text-ink ${column.numeric ? "flex-row-reverse" : ""}`}
                        onClick={() => setSort((current) => (current?.key === column.key ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" } : { key: column.key, direction: column.numeric ? "desc" : "asc" }))}
                      >
                        {column.header}
                        {active ? sort?.direction === "asc" ? <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /> : <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5 opacity-50" />}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {groups ? (
            groups.map((group) => {
              const members = group.ids.map((id) => byId.get(String(id))).filter((row): row is Row => Boolean(row));
              return members.length ? (
                <FoldTbody key={group.key} label={group.label} count={members.length} colSpan={shown.length} testId="table-group">
                  {members.map(renderRow)}
                </FoldTbody>
              ) : null;
            })
          ) : (
            <tbody>{visible.map(renderRow)}</tbody>
          )}
        </table>
      </div>
      </FoldScope>
      {pages > 1 && (
        <nav aria-label={`${caption}: pages`} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-label">
          <span className="text-ink-muted">
            {((current - 1) * PAGE_SIZE + 1).toLocaleString("en-IN")}–{Math.min(current * PAGE_SIZE, sorted.length).toLocaleString("en-IN")} of {sorted.length.toLocaleString("en-IN")}
          </span>
          <span className="flex items-center gap-1">
            <button type="button" className="btn-ghost btn-compact" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Previous page">
              ←
            </button>
            {Array.from({ length: pages }, (_, index) => index + 1)
              .filter((value) => value === 1 || value === pages || Math.abs(value - current) <= 1)
              .map((value, index, list) => (
                <span key={value} className="flex items-center">
                  {index > 0 && value - list[index - 1]! > 1 && <span className="px-1 text-ink-muted">…</span>}
                  <button
                    type="button"
                    aria-current={value === current ? "page" : undefined}
                    onClick={() => setPage(value)}
                    className={`grid h-8 min-w-8 place-items-center rounded-md px-2 ${value === current ? "bg-primary-solid font-semibold text-on-solid" : "hover:bg-surface-muted"}`}
                  >
                    {value}
                  </button>
                </span>
              ))}
            <button type="button" className="btn-ghost btn-compact" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Next page">
              →
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}
