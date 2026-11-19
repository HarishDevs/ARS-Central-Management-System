// v1.58.0 (D-351, owner: "i need sorting in all the tables asc to desc or vice
// versa in all columns in all tables available in application"). Shared by every
// table: the address carries ?sortBy=<column>&dir=asc|desc; a column title links
// to the next direction. Pure (used by server pages and tests).
export type SortDir = "asc" | "desc";
export interface ColumnSort<K extends string = string> {
  sortBy: K | null;
  dir: SortDir;
}

const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);

// Read ?sortBy and ?dir against the table's own column keys (anything else is ignored).
export function parseColumnSort<K extends string>(query: Record<string, unknown>, columns: readonly K[], fallback: ColumnSort<K> = { sortBy: null, dir: "asc" }): ColumnSort<K> {
  const by = one(query.sortBy);
  const dir = one(query.dir);
  // An unknown column means "no column sort": the table's own default, direction included.
  if (!(typeof by === "string" && (columns as readonly string[]).includes(by))) return { ...fallback };
  return { sortBy: by as K, dir: dir === "desc" ? "desc" : dir === "asc" ? "asc" : by === fallback.sortBy ? fallback.dir : "asc" };
}

// Clicking a column: the same column flips its direction; another column starts ascending.
export function nextDir(current: ColumnSort, column: string): SortDir {
  return current.sortBy === column ? (current.dir === "asc" ? "desc" : "asc") : "asc";
}

export const sqlDir = (dir: SortDir) => (dir === "desc" ? "DESC" : "ASC");

// Compare two cell values: empty last (whatever the direction), numbers and
// dates by value, text naturally (case-insensitive, "10" after "9").
export function compareValues(a: unknown, b: unknown): number {
  const emptyA = a === null || a === undefined || a === "";
  const emptyB = b === null || b === undefined || b === "";
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en-IN", { numeric: true, sensitivity: "base" });
}

// Sort rows already on the page (tables that aren't paged by the server).
// Empty values stay last in both directions; ties keep their order.
export function sortRows<T>(rows: readonly T[], accessor: (row: T) => unknown, dir: SortDir): T[] {
  return rows
    .map((row, index) => ({ row, index, value: accessor(row) }))
    .sort((a, b) => {
      const emptyA = a.value === null || a.value === undefined || a.value === "";
      const emptyB = b.value === null || b.value === undefined || b.value === "";
      if (emptyA !== emptyB) return emptyA ? 1 : -1;
      const compared = compareValues(a.value, b.value);
      return (dir === "desc" ? -compared : compared) || a.index - b.index;
    })
    .map((item) => item.row);
}

// An address with the sort for one column (other parameters kept, page reset).
export function sortHref(path: string, query: Record<string, unknown>, column: string, dir: SortDir): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "sortBy" || key === "dir" || key === "page" || value === undefined || value === null || value === "") continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  params.set("sortBy", column);
  params.set("dir", dir);
  return `${path}?${params.toString()}`;
}
