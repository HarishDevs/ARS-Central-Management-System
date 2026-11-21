import { hasModule } from "@/server/modules/modules";
import type { Metadata } from "next";
import { AlarmClock, CalendarClock, CalendarRange, CheckCircle2, ListTodo } from "lucide-react";
import { paneLinks, paneTaskId, TaskPane, WithPane } from "@/features/work/TaskPane";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MyTasks, MyTasksGrid } from "@/features/work/MyTasks";
import { toGridTask } from "@/server/work/grid-rows";
import { DEFAULT_GRID, parseGridConfig } from "@/server/work/grid";
import { peopleOptions } from "@/server/work/page-context";
import { Avatar } from "@/features/ui/Display";
import { CreateTaskButton } from "@/features/work/client";
import { DigestToggle } from "@/features/work/MoreParts";
import { getDbPool } from "@/lib/db/client";
import type { RowDataPacket } from "mysql2/promise";
import { TaskCalendar } from "@/features/work/TaskCalendar";
import { indiaDayOf } from "@/features/work/format";
import { listMyTabs, listTaskItems, listVisibleProjects, listWorkViews, workDensity } from "@/lib/db/repositories/work.repository";
import { buildStrip, MY_TASKS_VIEWS, parseTabConfig, pickTab, tabHref } from "@/server/work/view-tabs";
import { ViewTabs } from "@/features/work/ViewTabs";
import { summarySection, summarySections } from "@/server/work/my-summary";
import type { GridConfig } from "@/server/work/grid";
import { featureOn } from "@/server/settings/features";
import { LiveRefresh } from "@/features/work/useLiveRefresh";
import { workPage } from "@/server/work/page-context";
import { calendarHolidays } from "@/server/work/holiday-store";
import { isMobileLayout } from "@/server/ui/layout-mode";
import { MobileTasks } from "@/features/mobile/MobileTasks";

export const metadata: Metadata = { title: "Task Summary" };
export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "list", label: "List" },
  { key: "board", label: "Board" },
  { key: "calendar", label: "Calendar" },
] as const;

// D-215: everything assigned to me, from every project and none, in my own
// sections. Completed tasks of the last 7 days show when asked.
export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    done?: string;
    month?: string;
    task?: string;
    tab?: string;
    sort?: string;
    group?: string;
  }>;
}) {
  const { user, viewer } = await workPage();
  const params = await searchParams;
  // v1.43.0: phones get the mobile task lists (a task link still opens its page).
  if (await isMobileLayout()) {
    const paneTask = paneTaskId(params.task);
    if (paneTask) redirect(`/users/tasks/${paneTask}`);
    return <MobileTasks userId={user.id} tab={params.tab} sort={params.sort} group={params.group} projectsOn={hasModule(user, "PROJECT")} />;
  }
  // v1.63.0 (D-369, PM-A13): with "pm_foundations" on, My Tasks has the
  // person's own tab strip (List, Board, Calendar and any they add), like a project.
  const pmOn = await featureOn("pm_foundations", user);
  const tabData = pmOn ? await listMyTabs(user.id) : null;
  const strip = tabData ? buildStrip(tabData.rows, tabData.tabsSet, tabData.defaultView, MY_TASKS_VIEWS) : [];
  const activeTab = tabData ? pickTab(strip, { tab: params.tab, view: params.view }) : null;
  const activeRow = activeTab?.id ? (tabData?.rows.find((row) => row.id === activeTab.id) ?? null) : null;
  const view = activeTab ? (activeTab.type.toLowerCase() as "list" | "board" | "calendar") : params.view === "board" || params.view === "calendar" ? params.view : "list";
  const showDone = true;
  const now = new Date();
  const today = indiaDayOf(now);
  // v1.54.3 (owner: "rename My Tasks as Task Summary: a summary of tasks
  // overdue, due today and due in the next 7 days; only incomplete tasks and
  // tasks completed today"). Everything else is on Assigned to me.
  const weekEnd = indiaDayOf(new Date(now.getTime() + 7 * 86_400_000));
  const todayStart = new Date(`${today}T00:00:00+05:30`);
  const IST_DUE = "DATE(DATE_ADD(t.due_at, INTERVAL 330 MINUTE))";
  // v1.63.0 (D-369): with the switch on, open tasks given by someone else in
  // the last 3 days are listed too (Recently assigned), whatever their due date.
  const recentSince = new Date(now.getTime() - 3 * 86_400_000);
  const where = [
    "t.assignee_id = ?",
    "t.deleted_at IS NULL",
    `((t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at IS NOT NULL AND ${IST_DUE} <= ?) OR (t.status = 'COMPLETED' AND t.completed_at >= ?)${pmOn ? " OR (t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.created_by <> t.assignee_id AND t.assigned_at >= ?)" : ""})`,
  ];
  // D-257 / v1.54.3: the summary cards, counted in the database, for the
  // same tasks the summary lists.
  const OPEN = "t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at IS NOT NULL";
  const [[cardRow]] = await getDbPool().query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${OPEN} AND ${IST_DUE} <= ?), 0) AS open_count,
            COALESCE(SUM(${OPEN} AND ${IST_DUE} < ?), 0) AS overdue,
            COALESCE(SUM(${OPEN} AND ${IST_DUE} = ?), 0) AS today,
            COALESCE(SUM(${OPEN} AND ${IST_DUE} > ? AND ${IST_DUE} <= ?), 0) AS upcoming,
            COALESCE(SUM(t.status = 'COMPLETED' AND t.completed_at >= ?), 0) AS done_today
     FROM tasks t WHERE t.assignee_id = ? AND t.deleted_at IS NULL`,
    [weekEnd, today, today, today, weekEnd, todayStart, user.id],
  );
  const cards = [
    { key: "open", label: "To do in the summary", value: Number(cardRow?.open_count ?? 0), icon: ListTodo, tone: "text-primary-700" },
    { key: "overdue", label: "Overdue", value: Number(cardRow?.overdue ?? 0), icon: AlarmClock, tone: "text-danger-600" },
    { key: "today", label: "Due today", value: Number(cardRow?.today ?? 0), icon: CalendarClock, tone: "text-warning-600" },
    { key: "upcoming", label: "Next 7 days", value: Number(cardRow?.upcoming ?? 0), icon: CalendarRange, tone: "text-primary-700" },
    { key: "done", label: "Completed today", value: Number(cardRow?.done_today ?? 0), icon: CheckCircle2, tone: "text-success-600" },
  ];
  const [list, digestOff] = await Promise.all([
    listTaskItems(where, [user.id, weekEnd, todayStart, ...(pmOn ? [recentSince] : [])], "t.due_at IS NULL, t.due_at, t.id", 1000),
    getDbPool()
      .query<RowDataPacket[]>("SELECT 1 FROM user_settings WHERE user_id = ? AND setting_key = 'work.digest' AND value = 'OFF'", [user.id])
      .then(([rows]) => rows.length > 0),
  ]);
  // v1.54.4 (owner): Task Summary's own sections, by date (not the person's
  // sections): Overdue, Due today, Due in the next 7 days, Completed today.
  // v1.63.0 (D-369): plus "Recently assigned" with the switch on (server/work/my-summary.ts).
  const SUMMARY = summarySections(pmOn);
  const rows = list.items.map((task) => {
    const sectionId = summarySection({ status: task.status, dueDay: task.dueAt ? indiaDayOf(task.dueAt) : null, assignedAt: task.assignedAt, selfAssigned: task.createdBy === user.id }, today, now, pmOn);
    // By due date within each section.
    const position = task.dueAt ? task.dueAt.getTime() / 1000 : 9e9;
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt?.toISOString() ?? null,
      sectionId,
      position,
      assignedByName: task.createdByName,
      selfAssigned: task.createdBy === user.id,
      projects: task.projects,
      subtasks: task.subtasks,
      subtasksOpen: task.subtasksOpen,
      comments: task.comments,
      isPeriodic: task.isPeriodic,
      priority: task.priority, // v1.47.0
      approval: task.approval ?? null,
    };
  });
  // D-220: the List is the shared table, with the person's saved tabs.
  const [savedTabs, gridPeople, gridProjects] = await Promise.all([pmOn ? Promise.resolve([]) : listWorkViews("MY_TASKS", user.id), peopleOptions(), listVisibleProjects(viewer)]);
  const currentTab = savedTabs.find((item) => String(item.id) === params.tab) ?? null;
  // v1.61.0 (D-367): the row density choice (with "pm_foundations" on).
  const density = pmOn ? await workDensity(user.id) : undefined;
  const gridRows = list.items.map((task) => {
    const row = rows.find((item) => item.id === task.id)!;
    return toGridTask(task, user.id, true, row.sectionId, row.position);
  });
  const link = (changes: Record<string, string | null>) => {
    const query = new URLSearchParams({
      ...(activeTab ? (activeTab.id !== null ? { tab: String(activeTab.id) } : { view: activeTab.type.toLowerCase() }) : view !== "list" ? { view } : {}),
      ...(showDone ? { done: "1" } : {}),
    });
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) query.delete(key);
      else query.set(key, value);
    }
    const text = query.toString();
    return `/users/work/my-tasks${text ? `?${text}` : ""}`;
  };
  // D-219: a task opens in the pane beside the list.
  const links = paneLinks("/users/work/my-tasks", params);
  const paneId = paneTaskId(params.task);
  const pane = paneId ? <TaskPane taskId={paneId} user={user} closeHref={links.close} /> : null;
  return (
    <>
      <header className="mb-4 flex flex-wrap items-center gap-3" data-testid="my-tasks-header">
        <span className="page-icon grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-primary-50 text-primary-700 shadow-card" aria-hidden="true">
          <ListTodo className="h-6 w-6" />
        </span>
        <Avatar name={user.name} />
        <h1 className="text-title font-semibold tracking-tight">Task Summary</h1>
        <span className="text-caption text-ink-muted">
          Your tasks overdue, due today and due in the next 7 days, and what you completed today. Everything else is on{" "}
          <Link href="/users/tasks" className="link">
            Assigned to me
          </Link>
          .
        </span>
        <span className="ml-auto">
          <CreateTaskButton label="Add task" />
        </span>
      </header>
      <ul className="status-cards scroll-hint mb-4 flex gap-2 overflow-x-auto pb-1 2xl:grid 2xl:grid-cols-5 2xl:overflow-visible" data-testid="task-cards" aria-label="Your tasks at a glance">
        {cards.map((card) => (
          <li key={card.key} className="status-card flex min-w-[8rem] shrink-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
            <card.icon className={`h-5 w-5 shrink-0 ${card.tone}`} aria-hidden="true" />
            <span>
              <span className="block text-title font-semibold leading-none tabular-nums">{card.value.toLocaleString("en-IN")}</span>
              <span className="text-caption text-ink-muted">{card.label}</span>
            </span>
          </li>
        ))}
      </ul>
      {/* v1.61.0 (D-366): fresh every 15 s while visible, on focus and after changes. */}
      <LiveRefresh />
      <WithPane pane={pane}>
        {activeTab && <ViewTabs scope="MY_TASKS" base="/users/work/my-tasks" strip={strip} activeKey={activeTab.key} canEdit label="Task Summary views" />}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {!activeTab && (
          <nav aria-label="Task Summary views" className="flex flex-wrap gap-1 border-b border-line" data-testid="view-tabs">
            {VIEWS.map((item) => (
              <span key={item.key} className="contents">
                <Link
                  href={link({ view: item.key === "list" ? null : item.key, tab: null })}
                  aria-current={view === item.key && !currentTab ? "page" : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 text-label ${view === item.key && !currentTab ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                  {item.label}
                </Link>
                {item.key === "list" &&
                  savedTabs.map((tab) => (
                    <Link
                      key={tab.id}
                      href={`/users/work/my-tasks?tab=${tab.id}`}
                      aria-current={currentTab?.id === tab.id ? "page" : undefined}
                      className={`-mb-px border-b-2 px-3 py-2 text-label ${currentTab?.id === tab.id ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
                    >
                      {tab.name}
                    </Link>
                  ))}
              </span>
            ))}
          </nav>
          )}
          <span className="ml-auto">
            <DigestToggle on={!digestOff} />
          </span>
          {view !== "list" && (
            <Link href={link({ done: params.done === "1" ? null : "1" })} className="text-label link">
              {params.done === "1" ? "Hide completed" : "Show completed (last 7 days)"}
            </Link>
          )}
          <Link href="/users/tasks" className="text-label link">
            Table with filters
          </Link>
        </div>
        {view === "calendar" ? (
          <TaskCalendar
            tasks={rows.map((row) => ({
              id: row.id,
              title: row.title,
              status: row.status,
              dueAt: row.dueAt,
              assigneeId: user.id,
              isMilestone: false,
            }))}
            month={/^\d{4}-\d{2}$/.test(params.month ?? "") ? params.month! : today.slice(0, 7)}
            todayDay={today}
            canEdit
            meId={user.id}
            monthHref={`${activeTab ? tabHref("/users/work/my-tasks", activeTab) : link({ view: "calendar" })}&month=`}
            holidays={await calendarHolidays(undefined, viewer.departmentId)}
          />
        ) : view === "list" ? (
          <MyTasksGrid
            key={activeTab?.key ?? `list:${currentTab?.id ?? ""}`}
            rows={gridRows}
            sections={SUMMARY}
            fixed
            density={density}
            initial={activeTab ? (parseTabConfig("LIST", activeRow?.config) as GridConfig) : currentTab ? parseGridConfig(currentTab.config) : { ...DEFAULT_GRID, group: "section" }}
            view={
              activeTab
                ? { scope: "MY_TASKS", scopeId: user.id, canSave: true, current: activeTab.id ? { id: activeTab.id, name: activeTab.name } : null, tabKey: activeTab.key, tabName: activeTab.name, phaseA: true }
                : { scope: "MY_TASKS", scopeId: user.id, canSave: true, current: currentTab ? { id: currentTab.id, name: currentTab.name } : null }
            }
            people={gridPeople}
            projects={gridProjects.map((project) => ({ id: project.id, name: project.name }))}
            meId={user.id}
            nowIso={now.toISOString()}
          />
        ) : (
          <MyTasks
            sections={SUMMARY}
            fixed
            tasks={rows}
            layout={view === "board" ? "BOARD" : "LIST"}
            nowIso={now.toISOString()}
          />
        )}
      </WithPane>
    </>
  );
}
