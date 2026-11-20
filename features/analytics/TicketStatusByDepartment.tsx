"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { PriorityFilter, StatusCounts, StatusRow, StatusTable } from "@/server/tickets/status-summary";

// v1.59.2 (D-360, owner: "Priority wise IT Software Issues Status"): one table
// per ticket form, a row per requester's department, and a Total row kept last
// (in the footer). The server works out the tables for All and for each
// priority; the ?tpriority= link only picks which one shows. Every other query
// parameter of the Analytics page is kept.
const PRIORITY_PARAM = "tpriority";

type Column = "department" | keyof StatusCounts;
const COLUMNS: { key: Column; label: string }[] = [
  { key: "department", label: "Department" },
  { key: "total", label: "Total" },
  { key: "onTime", label: "Ontime" },
  { key: "delay", label: "Delay" },
  { key: "overdue", label: "OverDue" },
  { key: "notDue", label: "NotDue" },
];

export function TicketStatusByDepartment({ options, tables, from, to }: { options: { value: PriorityFilter; label: string }[]; tables: Partial<Record<PriorityFilter, StatusTable[]>>; from: string; to: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const asked = params.get(PRIORITY_PARAM);
  const chosen: PriorityFilter = options.some((option) => option.value === asked) ? (asked as PriorityFilter) : "ALL";
  const chosenLabel = options.find((option) => option.value === chosen)?.label ?? "All";
  const hrefFor = (value: PriorityFilter) => {
    const next = new URLSearchParams(params.toString());
    if (value === "ALL") next.delete(PRIORITY_PARAM);
    else next.set(PRIORITY_PARAM, value);
    const text = next.toString();
    return text ? `${pathname}?${text}` : pathname;
  };
  const shown = tables[chosen] ?? [];

  return (
    <div data-testid="ticket-status-by-department">
      <nav aria-label="Priority" className="mb-3 flex flex-wrap items-center gap-2 text-label">
        <span className="mr-1 text-ink-muted">Priority:</span>
        {options.map((option) => (
          <Link
            key={option.value}
            href={hrefFor(option.value)}
            scroll={false}
            aria-current={option.value === chosen ? "true" : undefined}
            className={`rounded-md px-3 py-1.5 ${option.value === chosen ? "bg-primary-50 font-semibold text-primary-700" : "text-ink-muted hover:bg-surface-muted"}`}
            data-testid="ticket-status-priority"
          >
            {option.label}
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <p className="text-label text-ink-muted">No tickets raised in this period.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {shown.map((table) => (
            <StatusTableView key={table.categoryId} table={table} priority={chosenLabel} from={from} to={to} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusTableView({ table, priority, from, to }: { table: StatusTable; priority: string; from: string; to: string }) {
  const [sort, setSort] = useState<{ column: Column; dir: "asc" | "desc" } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return table.rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...table.rows].sort((a: StatusRow, b: StatusRow) => {
      if (sort.column === "department") {
        // Others stays last whichever way the names sort.
        if ((a.departmentId === null) !== (b.departmentId === null)) return a.departmentId === null ? 1 : -1;
        return sign * a.department.localeCompare(b.department, "en-IN", { sensitivity: "base" });
      }
      return sign * (a[sort.column] - b[sort.column]) || a.department.localeCompare(b.department, "en-IN");
    });
  }, [table.rows, sort]);
  const title = `${table.categoryName} issues status`;

  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-label font-semibold">
          {title} <span className="font-normal text-ink-muted">· Priority: {priority}</span>
        </h3>
        <p className="text-caption text-ink-muted">
          From date <span className="tabular-nums text-ink">{from}</span> · To date <span className="tabular-nums text-ink">{to}</span>
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="data-table w-full min-w-[480px] text-label" data-testid="ticket-status-table">
          <caption className="sr-only">
            {title}, priority {priority}, raised from {from} to {to}
          </caption>
          <thead className="text-left text-caption text-ink-muted">
            <tr>
              {COLUMNS.map((column, index) => {
                const active = sort?.column === column.key;
                const Icon = active ? (sort!.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                const next = active && sort!.dir === "asc" ? "desc" : "asc";
                return (
                  <th key={column.key} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-3 py-2 ${index > 0 ? "text-right" : ""}`}>
                    <button type="button" onClick={() => setSort({ column: column.key, dir: next })} className="inline-flex items-center gap-1 hover:text-ink" title={`Sort by ${column.label}, ${next === "asc" ? "ascending" : "descending"}`} data-testid="sort-link">
                      {column.label}
                      <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${active ? "" : "opacity-40"}`} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.departmentId ?? "others"}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {row.department}
                </th>
                <Counts counts={row} />
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line font-semibold">
            <tr>
              <th scope="row" className="px-3 py-2 text-left">
                Total
              </th>
              <Counts counts={table.total} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

// Delay and Overdue stand out (colour and weight); the column titles say what they are.
function Counts({ counts }: { counts: StatusCounts }) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{counts.total}</td>
      <td className="px-3 py-2 text-right tabular-nums">{counts.onTime}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${counts.delay > 0 ? "font-semibold text-warning-600" : ""}`}>{counts.delay}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${counts.overdue > 0 ? "font-semibold text-danger-600" : ""}`}>{counts.overdue}</td>
      <td className="px-3 py-2 text-right tabular-nums">{counts.notDue}</td>
    </>
  );
}
