import { PageHeader } from "@/features/shell/PageHeader";

// v1.89.0 (D-422, UIQA-CON-01 / RESP-01, UI unification batch 2): one list
// page pattern. From top to bottom:
//   PageHeader (title, the hover description, the count as meta, the one
//   primary "New …" action) → the view tabs (optional) → ListToolbar
//   (Filter, Sort, Group, Options, Search; features/ui/ListToolbar.tsx) →
//   the list itself.
// Below 768 px every `.data-table` inside the list area is drawn as cards
// (one card per row, the column name before each value: `data-label` on the
// cells), the way Approvals and Information already look on phones
// (`.table-cards` in styles/globals.css). Desktop tables are unchanged.
// v1.89.0 (D-424, batch 4): every list page is inside ListPage. A page whose
// header is richer than title / description / meta / action (a badge, a
// header shared with other screens) passes its own PageHeader as `header`;
// the order stays header → tabs → toolbar → list either way.
export function ListPage({
  title,
  description,
  meta,
  action,
  header,
  tabs,
  toolbar,
  testId,
  children,
}: {
  title?: string;
  description?: string;
  meta?: string;
  action?: React.ReactNode;
  header?: React.ReactNode;
  tabs?: React.ReactNode;
  toolbar?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-list-page data-testid={testId}>
      {header ??
        (title !== undefined && (
          <PageHeader title={title} description={description} meta={meta}>
            {action}
          </PageHeader>
        ))}
      {tabs}
      {toolbar}
      <div className="table-cards">{children}</div>
    </div>
  );
}

// The phone card's label for a cell: the column name, also read by screen
// readers in the card layout (the table header is hidden there).
export const cellLabel = (label: string) => ({ "data-label": label });
