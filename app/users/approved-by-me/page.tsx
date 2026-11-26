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
export const metadata: Metadata = { title: "Approved by me" };

export const dynamic = "force-dynamic";

// v1.8.0: Approved by me - every request where I approved a step, myself or for someone I cover, and where it is now.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireArea("users");
  const params = await searchParams;
  const views = await myListViews(user.id, VIEW_TARGET.APPROVED_BY_ME);
  // Opening it with no filters uses your default view, if you have one.
  // v1.72.1 (D-395): not after Clear on this list (openedPlainly).
  const defaultView = (await openedPlainly("/users/approved-by-me", params)) ? views.find((view) => view.isDefault && Object.keys(view.query).length > 0) : undefined;
  if (defaultView) redirect(`/users/approved-by-me?${new URLSearchParams(defaultView.query).toString()}`);
  const filters = parseListFilters(params, "APPROVED_BY_ME");
  const [result, counts, choices] = await Promise.all([listRequests("APPROVED_BY_ME", user.id, filters), tabCounts("APPROVED_BY_ME", user.id, filters), listChoices("APPROVED_BY_ME", user.id)]);
  const extras = await listExtras(VIEW_TARGET.APPROVED_BY_ME, columnsFor("APPROVED_BY_ME"), user.id, result.items, user.roles);
  return (
    <ListPage
      // v1.91.2 (D-436, owner: "Delete the header for ... Approved by me as well"): as Waiting for
      // me (D-435), no visible title bar; the Classic tab / Compact sidebar and breadcrumb name the
      // page, and one h1 stays for screen readers.
      header={<h1 className="sr-only">Approved by me</h1>}
    >
      <RequestListScreen
        base="APPROVED_BY_ME"
        path="/users/approved-by-me"
        filters={filters}
        result={result}
        counts={counts}
        choices={choices}
        views={views.map((view) => ({ id: view.id, name: view.name, href: `/users/approved-by-me?${new URLSearchParams(view.query).toString()}`, mine: true, shared: false, isDefault: view.isDefault, ownerName: view.ownerName }))}
        empty="You haven't approved anything yet."
        userId={user.id}
        progress={extras.progress}
        priority={extras.priority}
        groupData={extras.groupData}
        columns={extras.columns}
      />
    </ListPage>
  );
}
