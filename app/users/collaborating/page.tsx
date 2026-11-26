import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UsersRound } from "lucide-react";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { columnsFor, RequestListScreen, VIEW_TARGET } from "@/features/requests/RequestListScreen";
import { listExtras } from "@/server/requests/list-extras";
import { listChoices, listRequests, tabCounts } from "@/lib/db/repositories/request-lists.repository";
// v1.58.0 (D-354, owner: saved views are "Only mine"): only the person's own views show and set the default.
import { myListViews, openedPlainly } from "@/server/lists/views";
import { parseListFilters } from "@/server/requests/list-filters";
import { ListPage } from "@/features/ui/ListPage";
import { ListToolbar } from "@/features/ui/ListToolbar";
import { DataTable } from "@/features/ui/DataTable";
import { Badge } from "@/features/ui/Display";
import { RecordNo } from "@/features/ui/RecordNo";
import { CollaboratingTabs } from "@/features/collaborating/CollaboratingTabs";
import { STATUS_TONE } from "@/features/modules/TaskListScreen";
import { formatDate, formatDateTime } from "@/lib/format/date";
import { isOverdue, TASK_STATUS_LABEL } from "@/server/modules/task-rules";
import { nextDir, parseColumnSort } from "@/server/lists/sorting";
import { collabAccess } from "@/server/collaborating/service";
import { COLLAB_EMPTY, COLLAB_PAGE_SIZE, COLLAB_TASK_SORTS, collabTabHref, pickCollabTab } from "@/server/collaborating/tabs";
import { listCollabTasks } from "@/lib/db/repositories/collaborating.repository";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Collaborating" };

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;
const str = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

// Collaborating (v1.7.2: requests someone added me to follow).
// v1.91.0 (D-433, owner): one common screen, like Calendar and Analytics, with
// a tab per module the person collaborates in (Approvals, Tasks). D-434: a tab
// shows when the person has the module or is an active collaborator on an item
// of it (then they open those items as a Commenter); the module must be running
// and its record page not Hidden for them (server/collaborating/service.ts). A
// forced ?tab= of a tab they don't have falls back to the first allowed tab and
// reads nothing of that module.
// Nobody sees anyone else's collaborations: every query is the signed-in
// person's own (no user id is read from the address).
export default async function CollaboratingPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { user } = await requireArea("users");
  const params = await searchParams;
  const { tabs, counts } = await collabAccess(user);
  // No module with collaborators and no collaboration: the page isn't there for this person (the sidebar hides it too).
  if (tabs.length === 0) notFound();
  // Opening it with no filters uses your default view of the Approvals list, if you have one.
  // v1.72.1 (D-395): not after Clear on this list (openedPlainly).
  if (tabs.includes("approvals") && (await openedPlainly("/users/collaborating", params))) {
    const views = await myListViews(user.id, "collaborating");
    const defaultView = views.find((view) => view.isDefault && Object.keys(view.query).length > 0);
    if (defaultView) redirect(`/users/collaborating?${new URLSearchParams(defaultView.query).toString()}`);
  }
  const tab = pickCollabTab(params, tabs, counts)!;
  return (
    <ListPage
      header={<PageHeader title="Collaborating" meta="Everything people added you to: follow it and comment." description="Requests and tasks other people added you to as a collaborator, one tab per module. You can see them and comment (and add files in the modules you use); you don't approve or own them." icon={UsersRound} />}
      tabs={<CollaboratingTabs current={tab} tabs={tabs} counts={counts} />}
    >
      {tab === "approvals" ? <ApprovalsTab userId={user.id} roles={user.roles} params={params} /> : <TasksTab userId={user.id} params={params} />}
    </ListPage>
  );
}

// The Approvals tab: the request list as before v1.91.0 (filters, quick tabs, saved views, default view).
async function ApprovalsTab({ userId, roles, params }: { userId: number; roles: readonly string[]; params: Query }) {
  const filters = parseListFilters(params, "COLLAB");
  const [views, result, counts, choices] = await Promise.all([myListViews(userId, "collaborating"), listRequests("COLLAB", userId, filters), tabCounts("COLLAB", userId, filters), listChoices("COLLAB", userId)]);
  const extras = await listExtras(VIEW_TARGET.COLLAB, columnsFor("COLLAB"), userId, result.items, roles);
  return (
    <RequestListScreen
      base="COLLAB"
      path="/users/collaborating"
      filters={filters}
      result={result}
      counts={counts}
      choices={choices}
      views={views.map((view) => ({ id: view.id, name: view.name, href: `/users/collaborating?${new URLSearchParams(view.query).toString()}`, mine: true, shared: false, isDefault: view.isDefault, ownerName: view.ownerName }))}
      empty={COLLAB_EMPTY.approvals}
      userId={userId}
      progress={extras.progress}
      priority={extras.priority}
      groupData={extras.groupData}
      columns={extras.columns}
    />
  );
}

const TASK_COLUMNS = [
  { key: "task", header: "Task" },
  { key: "assignee", header: "Assigned to" },
  { key: "createdBy", header: "Created by" },
  { key: "status", header: "Status" },
  { key: "due", header: "Due" },
  { key: "updated", header: "Updated" },
  { key: "added", header: "You were added" },
];

// The Tasks tab: tasks people added you to as a collaborator (not your own,
// not assigned to you or by you). A row opens the task the usual way: the
// side pane on a computer, its own page on a phone (D-410).
async function TasksTab({ userId, params }: { userId: number; params: Query }) {
  const q = str(params.q).trim().slice(0, 100);
  const page = Math.max(1, Math.min(1000, Number(str(params.page)) || 1));
  const sort = parseColumnSort(params, COLLAB_TASK_SORTS);
  const { items, total } = await listCollabTasks(userId, { q, sort, page });
  const pages = Math.max(1, Math.ceil(total / COLLAB_PAGE_SIZE));
  const keep = { q: q || null, ...(sort.sortBy ? { sortBy: sort.sortBy, dir: sort.dir } : {}) };
  const href = (change: Record<string, string | number | null>) => collabTabHref("tasks", { ...keep, ...change });
  const now = new Date();
  return (
    <>
      <ListToolbar
        id="collab-tasks"
        path="/users/collaborating"
        label="Find tasks you collaborate on"
        lead={
          <span className="text-label text-ink-muted" role="status" data-testid="collab-total">
            {total.toLocaleString("en-IN")} task{total === 1 ? "" : "s"}
          </span>
        }
        keep={{ tab: "tasks", ...(sort.sortBy ? { sortBy: sort.sortBy, dir: sort.dir } : {}) }}
        search={{ name: "q", value: q, placeholder: "Task number or title" }}
        filterCount={0}
        clearHref={q ? href({ q: null, page: null }) : null}
      />
      <DataTable
        caption="Tasks you collaborate on"
        storageKey="collab-tasks"
        testId="collab-tasks-table"
        columns={TASK_COLUMNS.map((column) => ({ ...column, sortable: column.key !== "createdBy" }))}
        serverSort={{
          sortBy: sort.sortBy,
          dir: sort.dir,
          hrefs: Object.fromEntries(COLLAB_TASK_SORTS.map((column) => [column, href({ sortBy: column, dir: nextDir(sort, column), page: null })])),
        }}
        empty={q ? { title: "No task matches", body: "Try other words, or clear the search." } : { title: "No tasks here yet", body: COLLAB_EMPTY.tasks }}
        rows={items.map((task) => {
          const late = isOverdue({ status: task.status, dueAt: task.dueAt }, now);
          return {
            id: task.id,
            cells: {
              task: (
                <span data-testid="collab-task-row">
                  <Link href={`/users/tasks/${task.id}`} className="link font-medium">
                    {task.title}
                  </Link>
                  <span className="block">
                    <RecordNo no={task.taskNo} />
                  </span>
                </span>
              ),
              assignee: <span className="text-label">{task.assigneeName}</span>,
              createdBy: <span className="text-label">{task.createdByName}</span>,
              status: <Badge tone={STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>,
              due: (
                <span className={`text-label ${late ? "font-semibold text-danger-600" : ""}`}>
                  {task.dueAt ? formatDateTime(task.dueAt, { year: "auto" }) : "—"}
                  {late && <span className="block text-caption">Overdue</span>}
                </span>
              ),
              updated: <span className="text-label">{formatDateTime(task.updatedAt, { year: "auto" })}</span>,
              added: <span className="text-label">{formatDate(task.addedAt, { year: "auto" })}</span>,
            },
          };
        })}
      />
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-label">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="link">← Previous</Link> : <span />}
          <span className="text-ink-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={href({ page: page + 1 })} className="link">Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}

