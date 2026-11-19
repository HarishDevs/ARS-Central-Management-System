import { SavedViews, SaveViewForm } from "@/features/analytics/ReportForms";
import { currentQuery, myListViews } from "@/server/lists/views";

// v1.58.0 (D-353): a list's saved views (chips: open, make default, delete) and
// "Save this view" for what is on screen now (filters, group, sort, search).
// Views are the person's own. Put it under the toolbar, or in its Options.
export async function ListViews({ userId, target, path, query, compact = false }: { userId: number; target: string; path: string; query: Record<string, unknown>; compact?: boolean }) {
  const views = await myListViews(userId, target);
  const now = currentQuery(query);
  return (
    <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "mb-3"}`} data-testid="list-views">
      <SavedViews
        views={views.map((view) => ({
          id: view.id,
          name: view.name,
          href: `${path}${Object.keys(view.query).length ? `?${new URLSearchParams(view.query).toString()}` : ""}`,
          mine: true,
          shared: false,
          isDefault: view.isDefault,
          ownerName: view.ownerName,
        }))}
      />
      <SaveViewForm target={target} query={now} path={path} />
    </div>
  );
}
