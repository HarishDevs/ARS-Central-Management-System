"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { nextDir, sortRows, type ColumnSort } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "i need sorting in all the tables asc to desc or vice
// versa in all columns"): Home's My team table, every column sortable (first
// ascending, again descending). All the people are on the page, so it sorts
// here; the first 25 of the chosen order are shown, as before.
export interface TeamRow {
  id: number;
  name: string;
  managerName: string | null;
  direct: boolean;
  open: number;
  overdue: number;
  doneWeek: number;
}
type Column = "name" | "manager" | "open" | "overdue" | "done";
const VALUE: Record<Column, (row: TeamRow) => unknown> = {
  name: (row) => row.name,
  manager: (row) => row.managerName,
  open: (row) => row.open,
  overdue: (row) => row.overdue,
  done: (row) => row.doneWeek,
};

export function TeamWorkloadTable({ rows }: { rows: TeamRow[] }) {
  const [sort, setSort] = useState<ColumnSort<Column>>({ sortBy: null, dir: "asc" });
  const shown = (sort.sortBy ? sortRows(rows, VALUE[sort.sortBy], sort.dir) : rows).slice(0, 25);
  const head = (column: Column, label: string, className: string) => {
    const active = sort.sortBy === column;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    const next = active && sort.dir === "asc" ? "descending" : "ascending";
    return (
      <th scope="col" className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => setSort({ sortBy: column, dir: nextDir(sort, column) })}
          title={`Sort by ${label}, ${next}`}
         
          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${active ? "text-ink" : ""}`}
          data-testid="sort-link"
        >
          {label}
          <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${active ? "" : "opacity-40"}`} />
        </button>
      </th>
    );
  };
  return (
    <table className="w-full text-label" data-testid="team-workload">
      <thead className="text-left text-caption uppercase tracking-wide text-ink-faint">
        <tr>
          {head("name", "Person", "py-1 pr-3")}
          {head("manager", "Reports to", "py-1 pr-3")}
          {head("open", "Open", "py-1 pr-3 text-right")}
          {head("overdue", "Overdue", "py-1 pr-3 text-right")}
          {head("done", "Done (7 days)", "py-1 text-right")}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {shown.map((person) => (
          <tr key={person.id}>
            <td className="py-1.5 pr-3">
              <Link href={`/users/work/search?assignee=${person.id}`} className="link">
                {person.name}
              </Link>
              {person.direct && <span className="ml-1 text-caption text-ink-muted">(direct)</span>}
            </td>
            <td className="py-1.5 pr-3 text-ink-muted">{person.managerName ?? "—"}</td>
            <td className="py-1.5 pr-3 text-right">{person.open}</td>
            <td className={`py-1.5 pr-3 text-right ${person.overdue ? "font-semibold text-danger-600" : ""}`}>{person.overdue}</td>
            <td className="py-1.5 text-right">{person.doneWeek}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
