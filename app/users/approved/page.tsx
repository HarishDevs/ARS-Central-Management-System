import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { RequestListScreen, VIEW_TARGET, columnsFor } from "@/features/requests/RequestListScreen";
import { listExtras } from "@/server/requests/list-extras";
import { listChoices, listRequests, tabCounts } from "@/lib/db/repositories/request-lists.repository";
// v1.58.0 (D-354, owner: saved views are "Only mine"): only the person's own views show and set the default.
import { myListViews, openedPlainly } from "@/server/lists/views";
import { parseListFilters } from "@/server/requests/list-filters";
import { ListPage } from "@/features/ui/ListPage";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "My approved requests" };

export const dynamic = "force-dynamic";

// v1.8.0: My approved requests - everything I raised that was approved, with validity, amendments and who approved it.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("users");
  const params = await searchParams;
  const views = await myListViews(user.id, VIEW_TARGET.APPROVED_MINE);
  // Opening it with no filters uses your default view, if you have one.
  // v1.72.1 (D-395): not after Clear on this list (openedPlainly).
  const defaultView = (await openedPlainly("/users/approved", params)) ? views.find((view) => view.isDefault && Object.keys(view.query).length > 0) : undefined;
  if (defaultView) redirect(`/users/approved?${new URLSearchParams(defaultView.query).toString()}`);
  const filters = parseListFilters(params, "APPROVED_MINE");
  const [result, counts, choices] = await Promise.all([listRequests("APPROVED_MINE", user.id, filters), tabCounts("APPROVED_MINE", user.id, filters), listChoices("APPROVED_MINE", user.id)]);
  const extras = await listExtras(VIEW_TARGET.APPROVED_MINE, columnsFor("APPROVED_MINE"), user.id, result.items, user.roles);
  return (
    <ListPage
      // v1.91.3 (D-437, owner: "All the approval screen layout should match the Waiting for me"):
      // no visible title bar; the Classic tab / Compact sidebar and breadcrumb name the page, and
      // one h1 stays for screen readers.
      header={<h1 className="sr-only">My approved requests</h1>}
    >
      <RequestListScreen
        base="APPROVED_MINE"
        path="/users/approved"
        filters={filters}
        result={result}
        counts={counts}
        choices={choices}
        views={views.map((view) => ({ id: view.id, name: view.name, href: `/users/approved?${new URLSearchParams(view.query).toString()}`, mine: true, shared: false, isDefault: view.isDefault, ownerName: view.ownerName }))}
        empty="None of your requests has been approved yet."
        userId={user.id}
        progress={extras.progress}
        priority={extras.priority}
        groupData={extras.groupData}
        columns={extras.columns}
        // v1.91.3 (D-437): Waiting for me's layout (D-435): title-only rows, count and pager below the table.
        titleOnly
        pagerBelow
      />
    </ListPage>
  );
}
