import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireArea } from "@/server/authorization/guards";
import { columnsFor, RequestListScreen, VIEW_TARGET } from "@/features/requests/RequestListScreen";
import { OwnershipTabs } from "@/features/requests/OwnershipTabs";
import { listExtras } from "@/server/requests/list-extras";
import { baseTotal, listChoices, listRequests, tabCounts } from "@/lib/db/repositories/request-lists.repository";
// v1.58.0 (D-354, owner: saved views are "Only mine"): only the person's own views show and set the default.
import { applyDefaultListView, myListViews } from "@/server/lists/views";
import { parseListFilters } from "@/server/requests/list-filters";
import { ListPage } from "@/features/ui/ListPage";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "My pending requests" };

export const dynamic = "force-dynamic";

// My requests (F-14, v1.7.2): everything I raised, with the full filter set.
export default async function MyRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("users");
  const params = await searchParams;
  // v1.7.2: the old "Shared with me" tab is its own screen now.
  if (params.tab === "shared") redirect("/users/collaborating");
  // D-234 (Default effect): no filters in the address → your default view, as on the other lists.
  // v1.72.1 (D-395): not when the person pressed Clear on this list (the shared check).
  await applyDefaultListView(user.id, "my_requests", "/users/requests", params);
  const filters = parseListFilters(params, "MINE");
  const [result, counts, choices, views, mineTotal, sharedTotal] = await Promise.all([
    listRequests("MINE", user.id, filters),
    tabCounts("MINE", user.id, filters),
    listChoices("MINE", user.id),
    myListViews(user.id, "my_requests"),
    baseTotal("MINE", user.id),
    baseTotal("COLLAB", user.id),
  ]);
  const extras = await listExtras(VIEW_TARGET.MINE, columnsFor("MINE"), user.id, result.items, user.roles);
  return (
    <ListPage
      // v1.91.3 (D-437, owner: "All the approval screen layout should match the Waiting for me"):
      // no visible title bar (title, ⓘ, the line under it, and its New request button: New request is
      // the first item of My Approvals in the sidebar / Classic tabs, on Home's quick actions and in
      // Ctrl K); one h1 stays for screen readers. Raised by me / Shared with me stay (tabs above the list).
      header={<h1 className="sr-only">My pending requests</h1>}
    >
      <OwnershipTabs current="mine" mine={mineTotal} shared={sharedTotal} />
      <RequestListScreen
        base="MINE"
        path="/users/requests"
        filters={filters}
        result={result}
        counts={counts}
        choices={choices}
        views={views.map((view) => ({ id: view.id, name: view.name, href: `/users/requests?${new URLSearchParams(view.query).toString()}`, mine: true, shared: false, isDefault: view.isDefault, ownerName: view.ownerName }))}
        empty="You haven't raised any requests yet."
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
