import { SortTh } from "@/features/ui/SortTh";
import { nextDir, sortHref, type ColumnSort } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner): the header row of an Admin table whose every column
// sorts both ways (click: ascending; again: descending). A column without a
// `key` (buttons only) stays a plain title.
export interface SortColumn {
  key?: string;
  label: string;
  className?: string;
  srOnly?: boolean;
}

export function SortHead({ path, query, sort, columns, className }: { path: string; query: Record<string, unknown>; sort: ColumnSort; columns: readonly SortColumn[]; className?: string }) {
  return (
    <thead className={className}>
      <tr>
        {columns.map((column, index) =>
          column.key ? (
            <SortTh key={column.key} label={column.label} column={column.key} sortBy={sort.sortBy} dir={sort.dir} href={sortHref(path, query, column.key, nextDir(sort, column.key))} className={column.className} srOnly={column.srOnly} />
          ) : (
            <th key={`plain-${index}`} scope="col" className={column.className}>
              {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
            </th>
          ),
        )}
      </tr>
    </thead>
  );
}
