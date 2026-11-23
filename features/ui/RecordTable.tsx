import Link from "next/link";
import { FoldScope, FoldTbody } from "@/features/ui/GroupFold";
import { SortLink } from "@/features/ui/SortTh";
import { RowClickHost } from "@/features/ui/RecordPane";

// v1.85.0 (D-412, owner's Admin redesign): the one table every Records tab
// uses (approval requests, tasks, information, tickets, meetings): a numbered,
// spreadsheet-like grid with sticky header and first column, column sorting
// (links, so it stays in the address), folded groups, paging, and rows that
// open the record pane (the number is the link; a click on the row does the
// same). After the Astryx table-inbox template (MIT, structure only).
export interface RecordTableColumn {
  key: string;
  label: string;
  wide?: boolean;
  sort?: { href: string; active: boolean; dir: "asc" | "desc" };
}
export interface RecordTableRow {
  id: number;
  cells: React.ReactNode[]; // one per column; the first is the record number (made the link)
  openHref: string; // opens the pane (?open=<id>)
  fullHref: string; // the record's own page
  current?: boolean;
}

function Row({ row, index, columns }: { row: RecordTableRow; index: number; columns: RecordTableColumn[] }) {
  return (
    <tr data-row-href={row.openHref} aria-current={row.current ? "true" : undefined} className={`cursor-pointer odd:bg-surface even:bg-page hover:bg-primary-50/60 ${row.current ? "!bg-primary-50" : ""}`}>
      <td className="sticky left-0 border-b border-r border-line bg-inherit px-2 py-1.5 text-right tabular-nums text-ink-faint" data-row-number>{index}</td>
      {columns.map((column, cellIndex) => (
        <td key={column.key} data-label={cellIndex === 0 ? undefined : column.label} data-card-title={cellIndex === 0 ? "" : undefined} className={`border-b border-r border-line px-3 py-1.5 align-top ${column.wide ? "min-w-[14rem] max-w-[22rem]" : "whitespace-nowrap"}`}>
          {cellIndex === 0 ? (
            <Link href={row.openHref} scroll={false} data-open-link={row.fullHref} className="link font-medium" data-testid="record-open">
              {row.cells[0]}
            </Link>
          ) : (
            row.cells[cellIndex]
          )}
        </td>
      ))}
    </tr>
  );
}

export function RecordTable({
  caption,
  columns,
  rows,
  groups,
  firstRow,
  total,
  prevHref,
  nextHref,
  testId = "records-table",
}: {
  caption: string;
  columns: RecordTableColumn[];
  rows: RecordTableRow[];
  groups?: { key: string; label: string; rows: RecordTableRow[] }[] | null;
  firstRow: number;
  total: number;
  prevHref?: string | null;
  nextHref?: string | null;
  testId?: string;
}) {
  const position = new Map(rows.map((row, index) => [row.id, index]));
  const numbered = (row: RecordTableRow) => <Row key={row.id} row={row} index={firstRow + (position.get(row.id) ?? 0)} columns={columns} />;
  return (
    <FoldScope enabled={Boolean(groups)}>
      <RowClickHost />
      {/* v1.89.0 (D-422): phone cards below 768 (table-cards); UIQA-TBL-01: the column titles use the lists' 12 / 600. */}
      <div className="card table-cards overflow-hidden">
        <div className="max-h-[70vh] overflow-auto" data-testid={testId} data-table-scroll>
          <table className="w-max min-w-full border-collapse text-label" data-cards>
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 z-10 bg-surface-muted">
              <tr>
                <th scope="col" className="sticky left-0 z-[2] w-12 border-b border-r border-line bg-surface-muted px-2 py-2 text-right text-caption font-semibold text-ink-faint">
                  #
                </th>
                {columns.map((column) => (
                  <th key={column.key} scope="col" aria-sort={column.sort?.active ? (column.sort.dir === "asc" ? "ascending" : "descending") : undefined} className="whitespace-nowrap border-b border-r border-line px-3 py-2 text-left text-caption font-semibold text-ink-muted">
                    {column.sort ? <SortLink label={column.label} active={column.sort.active} dir={column.sort.dir} href={column.sort.href} /> : column.label}
                  </th>
                ))}
              </tr>
            </thead>
            {groups ? (
              groups.map((group) => (
                <FoldTbody key={group.key} label={group.label} count={group.rows.length} colSpan={columns.length + 1} testId="records-group">
                  {group.rows.map(numbered)}
                </FoldTbody>
              ))
            ) : (
              <tbody>{rows.map(numbered)}</tbody>
            )}
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 text-label text-ink-muted">
          <span>
            Rows {firstRow.toLocaleString("en-IN")}–{(firstRow + rows.length - 1).toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
          </span>
          <span className="flex gap-2">
            {prevHref && (
              <Link href={prevHref} className="btn-secondary btn-compact" rel="prev">
                Previous
              </Link>
            )}
            {nextHref && (
              <Link href={nextHref} className="btn-secondary btn-compact" rel="next">
                Next
              </Link>
            )}
          </span>
        </div>
      </div>
    </FoldScope>
  );
}
