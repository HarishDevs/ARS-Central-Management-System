import { FoldTbody } from "@/features/ui/GroupFold";
import { PagedRows } from "@/features/ui/PagedRows";
import type { RowGroup } from "@/server/lists/group-rows";

// v1.58.0 (D-354, owner: "by default when a group by is selected it should
// collapse all the group if needed we can open and see"): an Admin table's
// body. Grouped: one folding section per group (folded at first; wrap the
// table in <FoldScope enabled> for Expand all / Collapse all). Not grouped:
// the rows a page at a time (PagedRows) or all at once.
export function GroupedRows<T>({
  rows,
  groups,
  colSpan,
  render,
  paged = true,
  label,
}: {
  rows: readonly T[];
  groups: RowGroup<T>[] | null;
  colSpan: number;
  render: (row: T) => React.ReactNode;
  paged?: boolean;
  label?: string;
}) {
  if (groups)
    return (
      <>
        {groups.map((group) => (
          <FoldTbody key={group.key} label={group.label} count={group.items.length} colSpan={colSpan} testId="table-group">
            {group.items.map(render)}
          </FoldTbody>
        ))}
      </>
    );
  return paged ? (
    <PagedRows colSpan={colSpan} label={label}>
      {rows.map(render)}
    </PagedRows>
  ) : (
    <tbody>{rows.map(render)}</tbody>
  );
}
