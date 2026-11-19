import { SortTh } from "@/features/ui/SortTh";
import { nextDir, sortHref, type ColumnSort } from "@/server/lists/sorting";
import { listHref } from "@/server/lists/superadmin-lists";

// v1.58.0 (D-354, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): the sortable column titles of one Super Admin table. Each
// title links to the next direction for its column (other parameters kept).
export function sortHeads(path: string, query: Record<string, unknown>, sort: ColumnSort) {
  return function head(label: string, column: string, options: { className?: string; srOnly?: boolean } = {}) {
    return <SortTh key={column} label={label} column={column} sortBy={sort.sortBy} dir={sort.dir} href={sortHref(path, query, column, nextDir(sort, column))} className={options.className} srOnly={options.srOnly} />;
  };
}

// The toolbar's Group menu for a list (choices as links; the current one ticked).
export function groupMenu<K extends string>(path: string, query: Record<string, unknown>, group: K | null, choices: readonly K[], labels: Record<K, string>) {
  return {
    label: group ? labels[group] : null,
    clearHref: listHref(path, query, { group: null }),
    choices: choices.map((value) => ({ label: labels[value], href: listHref(path, query, { group: value }), active: group === value })),
  };
}
