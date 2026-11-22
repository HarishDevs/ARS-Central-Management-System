import { hasModule } from "@/server/modules/modules";
import type { Metadata } from "next";
import { AlarmClock, CalendarClock, CalendarRange, CheckCircle2, ListTodo } from "lucide-react";
import { paneLinks, paneTaskId, TaskPane, WithPane } from "@/features/work/TaskPane";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomiseButton, MyTasks, MyTasksGrid, MyTasksTitle, TabSettingsBar } from "@/features/work/MyTasks";
import { fieldDefsOfProjects } from "@/lib/db/repositories/fields.repository";
import { cellsFor, fieldViews } from "@/server/work/fields-service";
import type { CellMap, FieldView } from "@/server/work/custom-fields";
import { DEFAULT_GRID, parseGridConfig } from "@/server/work/grid";
import { peopleOptions } from "@/server/work/page-context";
import { Avatar } from "@/features/ui/Display";
import { CreateTaskButton } from "@/features/work/client";
import { getDbPool } from "@/lib/db/client";
import type { RowDataPacket } from "mysql2/promise";
import { TaskCalendar } from "@/features/work/TaskCalendar";
import { indiaDayOf } from "@/features/work/format";
import { listMyTabs, listVisibleProjects, listWorkViews, mySectionCounts, workDensity } from "@/lib/db/repositories/work.repository";
import { buildStrip, MY_TASKS_VIEWS, parseTabConfig, pickTab, tabHref } from "@/server/work/view-tabs";
import { ViewTabs } from "@/features/work/ViewTabs";
import { loadTaskSummary } from "@/server/work/task-summary";
import { tabSettings } from "@/server/work/my-sections";
import { myRules, startMySections } from "@/server/work/my-rules";
import type { GridConfig } from "@/server/work/grid";
import { featureOn } from "@/server/settings/features";
import { LiveRefresh } from "@/features/work/useLiveRefresh";
import { workPage } from "@/server/work/page-context";
import { calendarHolidays } from "@/server/work/holiday-store";
import { isMobileLayout } from "@/server/ui/layout-mode";
import { MobileTasks } from "@/features/mobile/MobileTasks";
import { extrasOn } from "@/server/work/templates";
import { currentFeed } from "@/server/work/calendar-feeds";
import { CalendarFeedPanel } from "@/features/work/extras/CalendarFeedPanel";
import { listShares, managersAbove, openableSummaries, summaryAccess, summaryFields } from "@/server/work/summary-share";
import { parseSummaryBoard, parseSummaryCalendar, summaryListStart, type SummaryAccess } from "@/server/work/summary-views";
import { ReadOnlyBanner, ShareSummaryButton, SummarySwitcher } from "@/features/work/SummaryShare";
import { visibleTaskClause } from "@/lib/db/repositories/work.repository";

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
    of?: string;
    cal?: string;
    week?: string;
  }>;
}) {
  const { user, viewer } = await workPage();
  const params = await searchParams;
  // v1.77.0 (D-404, owner's decision 3): ?of=<person> opens someone else's Task
  // Summary, read-only: a manager above them (D-216) or a person they shared it
  // with. Anyone else is refused (deny by default). Only the tasks the viewer
  // may see are listed.
  const pmOn = await featureOn("pm_foundations", user);
  const asked = params.of && /^\d{1,10}$/.test(params.of) ? Number(params.of) : user.id;
  let access: SummaryAccess = "OWN";
  let ownerName = user.name;
  if (asked !== user.id) {
    if (!pmOn) redirect("/users/work/my-tasks");
    const found = await summaryAccess(viewer, asked);
    if (!found.access || !found.owner) return <NoAccess />;
    access = found.access;
    ownerName = found.owner.name;
  }
  const readOnly = access !== "OWN";
  const ownerId = readOnly ? asked : user.id;
  const base = readOnly ? `/users/work/my-tasks?of=${ownerId}` : "/users/work/my-tasks";
  // v1.43.0: phones get the mobile task lists (a task link still opens its page).
  // v1.77.0 (D-404): someone else's Task Summary keeps this page (read-only) on phones too.
  if (!readOnly && (await isMobileLayout())) {
    const paneTask = paneTaskId(params.task);
    if (paneTask) redirect(`/users/tasks/${paneTask}`);
    return <MobileTasks userId={user.id} tab={params.tab} sort={params.sort} group={params.group} projectsOn={hasModule(user, "PROJECT")} />;
  }
  // v1.63.0 (D-369, PM-A13): with "pm_foundations" on, My Tasks has the
  // person's own tab strip (List, Board, Calendar and any they add), like a project.
  const tabData = pmOn ? await listMyTabs(ownerId) : null;
  const strip = tabData ? buildStrip(tabData.rows, tabData.tabsSet, tabData.defaultView, MY_TASKS_VIEWS) : [];
  const activeTab = tabData ? pickTab(strip, { tab: params.tab, view: params.view }) : null;
  const activeRow = activeTab?.id ? (tabData?.rows.find((row) => row.id === activeTab.id) ?? null) : null;
  const view = activeTab ? (activeTab.type.toLowerCase() as "list" | "board" | "calendar") : params.view === "board" || params.view === "calendar" ? params.view : "list";
  // v1.76.0 (D-401, owner): each tab chooses its range (Summary window or All
  // my open tasks) and can be grouped by the person's own sections.
  const settings = tabSettings(activeRow?.config);
  // v1.77.0 (D-404): a Calendar tab's own settings (Show, weekends, Weeks or Months).
  const calendarView = view === "calendar" && activeTab ? parseSummaryCalendar(activeRow?.config) : null;
  // v1.77.0 (D-404): Customise › Fields: the person's default list columns (the owner's, on someone else's).
  const fieldsChoice = pmOn ? await summaryFields(ownerId) : null;
  const listStart: GridConfig = fieldsChoice ? summaryListStart(fieldsChoice) : { ...DEFAULT_GRID, group: "section" };
  const listConfig: GridConfig | null = view === "list" ? (activeTab ? (activeRow ? (parseTabConfig("LIST", activeRow.config) as GridConfig) : listStart) : null) : null;
  const mineStored = pmOn && ((view === "list" && listConfig?.group === "mySection") || (view === "board" && settings.sections === "mine"));
  if (mineStored && !readOnly) await startMySections(user.id);
  const rules = pmOn && !readOnly ? await myRules(user.id) : null;
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
  // v1.76.0 (D-401): the rows come from loadTaskSummary (the CSV uses it too).
  // D-257 / v1.54.3: the summary cards, counted in the database, for the
  // same tasks the summary lists.
  const OPEN = "t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND t.due_at IS NOT NULL";
  // v1.77.0 (D-404): on someone else's Task Summary the cards count only the tasks the viewer may see.
  const seen = readOnly ? visibleTaskClause(viewer) : null;
  const [[cardRow]] = await getDbPool().query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${OPEN} AND ${IST_DUE} <= ?), 0) AS open_count,
            COALESCE(SUM(${OPEN} AND ${IST_DUE} < ?), 0) AS overdue,
            COALESCE(SUM(${OPEN} AND ${IST_DUE} = ?), 0) AS today,
            COALESCE(SUM(${OPEN} AND ${IST_DUE} > ? AND ${IST_DUE} <= ?), 0) AS upcoming,
            COALESCE(SUM(t.status = 'COMPLETED' AND t.completed_at >= ?), 0) AS done_today
     FROM tasks t JOIN users a ON a.id = t.assignee_id WHERE t.assignee_id = ? AND t.deleted_at IS NULL${seen ? ` AND ${seen.sql}` : ""}`,
    [weekEnd, today, today, today, weekEnd, todayStart, ownerId, ...(seen ? seen.params : [])],
  );
  const cards = [
    { key: "open", label: "To do in the summary", value: Number(cardRow?.open_count ?? 0), icon: ListTodo, tone: "text-primary-700" },
    { key: "overdue", label: "Overdue", value: Number(cardRow?.overdue ?? 0), icon: AlarmClock, tone: "text-danger-600" },
    { key: "today", label: "Due today", value: Number(cardRow?.today ?? 0), icon: CalendarClock, tone: "text-warning-600" },
    { key: "upcoming", label: "Next 7 days", value: Number(cardRow?.upcoming ?? 0), icon: CalendarRange, tone: "text-primary-700" },
    { key: "done", label: "Completed today", value: Number(cardRow?.done_today ?? 0), icon: CheckCircle2, tone: "text-success-600" },
  ];
  // The person's own sections are loaded for List tabs (so "My sections" can be
  // chosen at once) and for Board tabs set to them.
  const wantMine = pmOn && (view === "list" || mineStored);
  const [summary, digestOff] = await Promise.all([
    loadTaskSummary(ownerId, { range: pmOn ? settings.range : "summary", recentOn: pmOn, mine: wantMine, now, viewer: readOnly ? viewer : undefined }),
    getDbPool()
      .query<RowDataPacket[]>("SELECT 1 FROM user_settings WHERE user_id = ? AND setting_key = 'work.digest' AND value = 'OFF'", [user.id])
      .then(([rows]) => rows.length > 0),
  ]);
  // v1.54.4 (owner): Task Summary's own sections, by date (not the person's
  // sections): Overdue, Due today, Due in the next 7 days, Completed today.
  // v1.63.0 (D-369): plus "Recently assigned" with the switch on (server/work/my-summary.ts).
  const SUMMARY = summary.dateSections;
  const counts = summary.mySections && !readOnly ? await mySectionCounts(user.id) : null;
  const mySections = summary.mySections?.map((section) => ({ id: section.id, name: section.name, system: section.system, count: counts?.get(section.id) ?? 0 }));
  const boardMine = view === "board" && settings.sections === "mine" && mySections;
  const rows = summary.items.map((task) => {
    const grid = summary.rows.find((item) => item.id === task.id)!;
    const sectionId = boardMine ? (grid.mySectionId ?? 0) : grid.sectionId!;
    const position = boardMine ? (grid.myPosition ?? 0) : grid.position;
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt?.toISOString() ?? null,
      sectionId,
      position,
      assignedByName: task.createdByName,
      selfAssigned: task.createdBy === ownerId,
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
  const gridRows = summary.rows;
  // v1.64.0 (D-371, "pm_planning"): the fields of the tasks' projects as columns
  // (a task shows a value only where one of its projects has the field).
  const planning = view === "list" && (await featureOn("pm_planning", user));
  let fieldColumns: { views: FieldView[]; values: CellMap; scope: Record<number, number[]> } | undefined;
  if (planning) {
    const byProject = await fieldDefsOfProjects([...new Set(gridRows.flatMap((task) => task.projects.map((project) => project.id)))]);
    const defs = [...new Map([...byProject.values()].flat().map((field) => [field.id, field])).values()];
    const scope = Object.fromEntries(gridRows.map((task) => [task.id, [...new Set(task.projects.flatMap((project) => (byProject.get(project.id) ?? []).map((field) => field.id)))]]));
    const views = (await fieldViews(defs, { id: user.id, name: user.name, roles: user.roles }, viewer, false)).map((field) => ({ ...field, canEdit: false }));
    fieldColumns = { views, values: await cellsFor(gridRows.map((task) => task.id), defs, viewer), scope };
  }
  const link = (changes: Record<string, string | null>) => {
    const query = new URLSearchParams({
      ...(readOnly ? { of: String(ownerId) } : {}),
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
  // v1.77.0 (D-404): the switcher's people, and (own summary) who it is shared with.
  const others = pmOn ? await openableSummaries(viewer) : null;
  const shareData = pmOn && !readOnly ? { shares: (await listShares(user.id)).map((share) => ({ id: share.id, name: share.name, label: share.label, grantedAt: share.grantedAt.toISOString() })), managers: await managersAbove(user.id) } : null;
  // D-219: a task opens in the pane beside the list.
  const links = paneLinks("/users/work/my-tasks", params);
  const paneId = paneTaskId(params.task);
  const pane = paneId ? <TaskPane taskId={paneId} user={user} closeHref={links.close} /> : null;
  // v1.70.0 (D-383, "pm_extras"): the person's My Tasks calendar feed.
  const feed = !readOnly && (await extrasOn(user)) ? await currentFeed("MY_TASKS", null, { id: user.id, name: user.name, roles: user.roles, modules: user.modules, sessionId: "", ipAddress: null }) : undefined;
  return (
    <>
      <header className="mb-4 flex flex-wrap items-center gap-3" data-testid="my-tasks-header">
        <span className="page-icon grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-primary-50 text-primary-700 shadow-card" aria-hidden="true">
          <ListTodo className="h-6 w-6" />
        </span>
        {/* v1.77.0 (D-404, spec §3.6): the picture opens the person's profile. */}
        <Link href={`/users/people/${ownerId}`} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600" aria-label={readOnly ? `${ownerName}'s profile` : "Your profile"} data-testid="my-tasks-avatar">
          <Avatar name={ownerName} />
        </Link>
        {/* v1.73.0 (D-396, spec S-04): the title's ▾ menu holds the page's actions (the morning email, Table with filters, the calendar feed, Print). */}
        <MyTasksTitle title={readOnly ? `${ownerName}'s Task Summary` : "Task Summary"} readOnly={readOnly} digestOn={!digestOff} feed={feed !== undefined} csvHref={activeTab ? `/api/work/my-tasks/export?tab=${encodeURIComponent(activeTab.key)}` : "/api/work/my-tasks/export"} />
        {readOnly ? (
          <span className="text-caption text-ink-muted">{settings.range === "all" ? "Their open tasks" : "Their tasks overdue, due today and due in the next 7 days"}, as far as you may see them.</span>
        ) : (
          <span className="text-caption text-ink-muted">
            {settings.range === "all" && pmOn ? "Every open task given to you, and what you completed today." : "Your tasks overdue, due today and due in the next 7 days, and what you completed today."} Everything else is on{" "}
            <Link href="/users/tasks" className="link">
              Assigned to me
            </Link>
            .
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {others && <SummarySwitcher current={readOnly ? { id: ownerId, name: ownerName } : null} shared={others.shared} team={others.team} />}
          {shareData && <ShareSummaryButton shares={shareData.shares} managers={shareData.managers} people={gridPeople} meId={user.id} />}
          {rules && <CustomiseButton rules={{ todayOn: rules.todayOn, upcomingOn: rules.upcomingOn, upcomingDays: rules.upcomingDays }} fields={fieldsChoice ? { hidden: fieldsChoice.hidden, hiddenFields: fieldsChoice.hiddenFields, customFields: (fieldColumns?.views ?? []).map((field) => ({ id: field.id, name: field.name })) } : undefined} />}
          {!readOnly && <CreateTaskButton label="Add task" />}
        </span>
      </header>
      {readOnly && <ReadOnlyBanner name={ownerName} why={access === "MANAGER" ? "You see it because they report to you" : "They shared it with you"} />}
      {/* v1.74.1 (D-397): the row scrolls sideways below 1536 px, so it takes keyboard focus (arrow keys scroll it). */}
      <ul className="status-cards scroll-hint mb-4 flex gap-2 overflow-x-auto pb-1 2xl:grid 2xl:grid-cols-5 2xl:overflow-visible" data-testid="task-cards" aria-label="Your tasks at a glance" tabIndex={0}>
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
        {activeTab && <ViewTabs scope="MY_TASKS" base={base} strip={strip} activeKey={activeTab.key} canEdit={!readOnly} label={readOnly ? `${ownerName}'s Task Summary views` : "Task Summary views"} />}
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
          {activeTab && !readOnly && <TabSettingsBar key={`${activeTab.key}:${settings.range}:${settings.sections}`} tabKey={activeTab.key} range={settings.range} sections={settings.sections} board={view === "board"} />}
          <span className="ml-auto" />
          {view !== "list" && (
            <Link href={link({ done: params.done === "1" ? null : "1" })} className="text-label link">
              {params.done === "1" ? "Hide completed" : "Show completed (last 7 days)"}
            </Link>
          )}
        </div>
        {view === "calendar" ? (
          <TaskCalendar
            key={activeTab?.key ?? "calendar"}
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
            canEdit={!readOnly}
            meId={user.id}
            monthHref={`${activeTab ? tabHref(base, activeTab) : link({ view: "calendar" })}&month=`}
            holidays={await calendarHolidays(undefined, viewer.departmentId)}
            planning={activeTab ? { unit: params.cal === "week" || params.cal === "month" ? params.cal : calendarView!.unit, week: /^\d{4}-\d{2}-\d{2}$/.test(params.week ?? "") ? params.week! : today, href: `${tabHref(base, activeTab)}&` } : undefined}
            settings={activeTab && calendarView ? { initial: calendarView, tabKey: activeTab.key, canSave: !readOnly } : undefined}
          />
        ) : view === "list" ? (
          <MyTasksGrid
            key={activeTab?.key ?? `list:${currentTab?.id ?? ""}`}
            rows={gridRows}
            sections={SUMMARY}
            fixed
            initial={listConfig && listConfig.group === "mySection" && !mySections ? { ...listConfig, group: "section" } : listConfig ?? (currentTab ? parseGridConfig(currentTab.config) : { ...DEFAULT_GRID, group: "section" })}
            mySections={mySections}
            resetTo={activeTab && !readOnly ? listStart : undefined}
            readOnly={readOnly}
            density={readOnly ? undefined : density}
            view={
              activeTab
                ? { scope: "MY_TASKS", scopeId: ownerId, canSave: !readOnly, current: activeTab.id ? { id: activeTab.id, name: activeTab.name } : null, tabKey: activeTab.key, tabName: activeTab.name, phaseA: true }
                : { scope: "MY_TASKS", scopeId: user.id, canSave: true, current: currentTab ? { id: currentTab.id, name: currentTab.name } : null }
            }
            people={gridPeople}
            projects={gridProjects.map((project) => ({ id: project.id, name: project.name }))}
            meId={user.id}
            nowIso={now.toISOString()}
            fields={fieldColumns}
          />
        ) : (
          <MyTasks
            key={activeTab?.key ?? view}
            sections={boardMine ? boardMine : SUMMARY}
            fixed={!boardMine}
            tasks={rows}
            layout={view === "board" ? "BOARD" : "LIST"}
            nowIso={now.toISOString()}
            readOnly={readOnly}
            boardView={view === "board" && activeTab ? { initial: parseSummaryBoard(activeRow?.config), tabKey: activeTab.key, canSave: !readOnly, sections: settings.sections, mineOffered: pmOn } : undefined}
          />
        )}
      </WithPane>
      {feed !== undefined && (
        <details id="my-tasks-feed" className="card mt-6 px-5 py-3" data-testid="my-tasks-feed">
          <summary className="cursor-pointer font-semibold">Calendar feed</summary>
          <div className="mt-3">
            <CalendarFeedPanel scope="MY_TASKS" current={feed ? { hint: feed.hint, createdAt: feed.createdAt.toISOString(), lastUsedAt: feed.lastUsedAt?.toISOString() ?? null } : null} />
          </div>
        </details>
      )}
    </>
  );
}

// v1.77.0 (D-404): someone else's Task Summary that isn't open to this person.
function NoAccess() {
  return (
    <section className="card mx-auto mt-8 max-w-lg px-6 py-8 text-center" data-testid="summary-no-access">
      <h1 className="text-title font-semibold">You can&apos;t open this Task Summary</h1>
      <p className="mt-2 text-label text-ink-muted">Only its owner, the managers above them and the people they share it with can open it. Ask them to share it with you.</p>
      <Link href="/users/work/my-tasks" className="btn-primary btn-compact mt-4 inline-flex w-auto">
        Go to my Task Summary
      </Link>
    </section>
  );
}
