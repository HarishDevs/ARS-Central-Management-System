import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/features/shell/PageHeader";
import { Badge } from "@/features/ui/Display";
import { SafeText } from "@/features/ui/SafeText";
import { ProjectWorkspace } from "@/features/work/ProjectWorkspace";
import { TaskCalendar } from "@/features/work/TaskCalendar";
import { Timeline } from "@/features/work/Timeline";
import { ScheduleView } from "@/features/work/ScheduleView";
import { StatusComposer } from "@/features/work/StatusComposer";
import { linksFor, projectSchedule } from "@/server/work/schedule-service";
import { getWorkingDays } from "@/lib/db/repositories/calendar.repository";
import { WEEKDAYS } from "@/server/workflows/calendar";
import { paneLinks, paneTaskId, TaskPane, WithPane } from "@/features/work/TaskPane";
import { toGridTask } from "@/server/work/grid-rows";
import { DEFAULT_GRID, parseGridConfig, type GridConfig } from "@/server/work/grid";
import { featureOn } from "@/server/settings/features";
import { buildStrip, parseTabConfig, pickTab, type BoardConfig } from "@/server/work/view-tabs";
import { childrenByParent } from "@/server/work/tree";
import { ViewTabs } from "@/features/work/ViewTabs";
import { LiveRefresh } from "@/features/work/useLiveRefresh";
import { ProjectCommandButton, RemoveStatusButton, StatusForm } from "@/features/work/ProjectForms";
import { ProjectHeader } from "@/features/work/ProjectHeader";
import { FromTemplateForm } from "@/features/work/MoreParts";
import { listDepartments } from "@/lib/db/repositories/organisation.repository";
import { countTemplateTasks, type TemplateTask } from "@/server/work/more-rules";
import { indiaDayOf } from "@/features/work/format";
import { listChildTasks, listProjectTabs, listWorkViews, workDensity, listProjectTasks, listSections, listStatusUpdates, projectCounts, projectFor, templateBody, touchRecentProject } from "@/lib/db/repositories/work.repository";
import { getDbPool } from "@/lib/db/client";
import { indiaDateTimeText } from "@/server/modules/settings";
import { PRIVACY_LABEL, PROJECT_ROLE_LABEL, projectAbilities, STATUS_KIND_LABEL, STATUS_KIND_TONE } from "@/server/work/access";
import { peopleOptions, workPage } from "@/server/work/page-context";
import { calendarHolidays } from "@/server/work/holiday-store";
import type { RowDataPacket } from "mysql2/promise";
import { RichText } from "@/features/work/RichText";
import { isMobileLayout } from "@/server/ui/layout-mode";
import { getUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { clampPaneWidth, PANE_SETTING } from "@/server/work/pm-rules";
import { cellsFor, projectFieldsFor } from "@/server/work/fields-service";
import { FieldDialogHost } from "@/features/work/FieldDialog";
import { Dashboard } from "@/features/work/reporting/Dashboard";
import { Workload } from "@/features/work/reporting/Workload";
import { loadDashboard, loadWorkload, reportingOn } from "@/server/work/reporting-service";
import { readLegacyTemplate } from "@/server/work/template-rules";
import { extrasOn, templateFor } from "@/server/work/templates";
import { TemplatePreview } from "@/features/work/extras/TemplatePreview";
import { FilesTab } from "@/features/work/extras/FilesTab";
import { MessagesTab } from "@/features/work/extras/MessagesTab";
import { PageTab } from "@/features/work/extras/PageTab";
import { loadMessages, loadPage, loadProjectFiles, mentionPeople } from "@/server/work/collab";
import { projectTime } from "@/server/work/time-tracking";
import { formatMinutes } from "@/server/work/collab-rules";

export const metadata: Metadata = { title: "Project" };
export const dynamic = "force-dynamic";

// D-219: Asana's order.
const VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "list", label: "List" },
  { key: "board", label: "Board" },
  { key: "timeline", label: "Timeline" },
  { key: "calendar", label: "Calendar" },
] as const;
// v1.65.0 (D-373): a Gantt tab (from the tab catalogue, with "pm_planning" on).
// v1.67.0 (D-375): Dashboard and Workload tabs (with "pm_reporting" on).
// v1.71.0 (D-384): Files, Messages and Page tabs (with "pm_extras" on).
type ViewKey = (typeof VIEWS)[number]["key"] | "gantt" | "dashboard" | "workload" | "files" | "messages" | "page";

// D-215: one project. Only people with a role on it (members, its department
// or everyone, by its privacy) can open it; anyone else gets "not found".
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    view?: string;
    month?: string;
    week?: string;
    cal?: string;
    created?: string;
    task?: string;
    status?: string;
    tab?: string;
    wfrom?: string;
    wunit?: string;
    wmetric?: string;
    thread?: string;
  }>;
}) {
  const { user, viewer } = await workPage();
  const { id } = await params;
  if (!/^\d{1,10}$/.test(id)) notFound();
  const found = await projectFor(Number(id), viewer);
  // v1.70.0 (D-383): with "pm_extras" on, a template opens as its full preview
  // (an organisation template for everyone with Projects).
  if ((!found || found.project.isTemplate) && viewer.projects !== false && (await extrasOn(user))) {
    const shown = await templateFor(Number(id), { id: user.id, name: user.name, roles: user.roles, modules: user.modules, sessionId: "", ipAddress: null });
    if (shown) {
      const [allDepartments, people] = await Promise.all([listDepartments(), shown.template.placeholders.length ? peopleOptions() : Promise.resolve([])]);
      return <TemplatePreview item={shown.item} template={shown.template} departments={allDepartments.filter((department) => department.active).map((department) => ({ id: department.id, name: department.name }))} people={people} />;
    }
  }
  if (!found) notFound();
  const { project, members, role } = found;
  const can = projectAbilities(role);
  // D-218: a template shows what it holds and makes projects.
  if (project.isTemplate) {
    const template = readLegacyTemplate(await templateBody(project.id));
    const departments = (await listDepartments()).filter((department) => department.active).map((department) => ({ id: department.id, name: department.name }));
    const lines = (tasks: TemplateTask[], level = 0): React.ReactNode[] =>
      tasks.flatMap((task, index) => [
        <li key={`${level}-${index}-${task.title}`} style={{ paddingLeft: level * 20 }} className="text-label">
          {task.isMilestone ? "◆ " : "• "}
          {task.title}
          <span className="text-caption text-ink-muted">
            {" "}
            · {template?.sections[task.section] ?? ""}
            {task.dueOffset !== null ? ` · due day ${task.dueOffset >= 0 ? "+" : ""}${task.dueOffset}` : ""}
          </span>
        </li>,
        ...lines(task.subtasks, level + 1),
      ]);
    return (
      <>
        <PageHeader title={project.name} meta={`Template · ${countTemplateTasks(template?.tasks ?? [])} tasks · ${template?.sections.length ?? 0} sections · Owner ${project.ownerName}`}>
          <Badge tone="info">Template</Badge>
          {can.manage && <ProjectCommandButton projectId={project.id} command="DELETE" label="Delete template" danger confirmText="Projects made from it stay." />}
        </PageHeader>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card px-5 py-4" aria-label="What it holds">
            <h2 className="mb-2 font-semibold">Sections and tasks</h2>
            {template?.fields.length ? <p className="mb-2 text-caption text-ink-muted">Fields: {template.fields.map((field) => field.name).join(", ")}</p> : null}
            <ul className="space-y-1" data-testid="template-tasks">
              {lines(template?.tasks ?? [])}
            </ul>
          </section>
          <section className="card px-5 py-4" aria-label="Use this template">
            <h2 className="mb-3 font-semibold">Use this template</h2>
            <FromTemplateForm templates={[{ id: project.id, name: project.name }]} departments={departments} />
          </section>
        </div>
      </>
    );
  }
  const query = await searchParams;
  // v1.61.0 (D-367): with "pm_foundations" on, every view is a tab of the
  // project's own strip (server/work/view-tabs.ts); off, the fixed views as before.
  const pmOn = await featureOn("pm_foundations", user);
  const tabData = pmOn ? await listProjectTabs(project.id) : null;
  const strip = tabData ? buildStrip(tabData.rows, tabData.tabsSet, tabData.defaultView) : [];
  const activeTab = tabData ? pickTab(strip, { tab: query.tab, view: query.view }) : null;
  const activeRow = activeTab?.id ? (tabData?.rows.find((row) => row.id === activeTab.id) ?? null) : null;
  const view: ViewKey = activeTab
    ? (activeTab.type.toLowerCase() as ViewKey)
    : VIEWS.some((item) => item.key === query.view)
      ? (query.view as ViewKey)
      : (project.defaultView.toLowerCase() as ViewKey);
  const now = new Date();
  const todayDay = indiaDayOf(now);
  const [sections, tasks, people, statuses, counts, starred, fields] = await Promise.all([
    listSections(project.id),
    listProjectTasks(project.id),
    can.edit ? peopleOptions() : Promise.resolve([]),
    view === "overview" ? listStatusUpdates(project.id) : Promise.resolve([]),
    projectCounts(project.id),
    getDbPool()
      .query<RowDataPacket[]>("SELECT 1 FROM work_favourites WHERE user_id = ? AND object_type = 'PROJECT' AND object_id = ?", [user.id, project.id])
      .then(([rows]) => rows.length > 0),
    // v1.64.0 (D-371): the project's custom fields (and whether this person may customise them).
    projectFieldsFor(project.id, { id: user.id, name: user.name, roles: user.roles, modules: user.modules }),
  ]);
  const planning = await featureOn("pm_planning", user);
  // v1.65.0 (D-373): the editable Timeline and the Gantt need the links, the working days and the holidays.
  const scheduleView = planning && (view === "timeline" || view === "gantt");
  const [scheduleLinks, workingWeekdays, scheduleHolidays] = scheduleView
    ? await Promise.all([linksFor(tasks.map((task) => task.id)), getWorkingDays().then((days) => days.map((day) => WEEKDAYS.indexOf(day))), calendarHolidays(undefined, viewer.departmentId)])
    : [[], [], {}];
  const statusSetup = planning && view === "overview" && can.edit ? await projectSchedule(project.id) : null;
  // v1.67.0 (D-375): the dashboard's widgets with their figures, or the workload grid.
  const reporting = await reportingOn(user);
  const actor = { id: user.id, name: user.name, roles: user.roles, modules: user.modules };
  const dashboard = reporting && view === "dashboard" ? await loadDashboard(project.id, actor) : null;
  const workload = reporting && view === "workload" ? await loadWorkload(project.id, actor, { from: query.wfrom, unit: query.wunit, metric: query.wmetric }) : null;
  // v1.71.0 (D-384): the Files, Messages and Page tabs, and the project's time totals (Overview).
  const extras = await extrasOn(user);
  const [projectFiles, messages, page, mentionList, timeTotals] = await Promise.all([
    extras && view === "files" ? loadProjectFiles(project.id, actor) : Promise.resolve(null),
    extras && view === "messages" ? loadMessages(project.id, actor) : Promise.resolve(null),
    extras && view === "page" ? loadPage(project.id, actor) : Promise.resolve(null),
    extras && (view === "messages" || view === "page") ? mentionPeople() : Promise.resolve([]),
    extras && view === "overview" ? projectTime(project.id, actor) : Promise.resolve(null),
  ]);
  // D-220: the project's saved tabs (List views with their filters, sort and groups).
  const savedTabs = pmOn ? [] : await listWorkViews("PROJECT", project.id);
  const currentTab = savedTabs.find((item) => String(item.id) === query.tab) ?? null;
  const values = fields ? await cellsFor(tasks.map((task) => task.id), fields.defs, viewer) : {};
  // v1.61.0 (D-367): subtasks shown inline in the List (treegrid), and the person's row density.
  const [subtaskRows, density] = await Promise.all([
    pmOn && view === "list" ? listChildTasks(tasks.map((task) => task.id)) : Promise.resolve([]),
    pmOn ? workDensity(user.id) : Promise.resolve("COMFORTABLE" as const),
  ]);
  await touchRecentProject(user.id, project.id).catch(() => undefined);
  const isMember = members.some((member) => member.type === "USER" && member.id === user.id);
  // D-220: the Share dialog's lists.
  const [shareDepartments, sharePeople] = await Promise.all([
    listDepartments().then((items) => items.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name }))),
    people.length ? Promise.resolve(people) : peopleOptions(),
  ]);
  const sectionName = new Map(sections.map((section) => [section.id, section.name]));
  const base = `/users/work/projects/${project.id}`;
  const month = /^\d{4}-\d{2}$/.test(query.month ?? "") ? query.month! : todayDay.slice(0, 7);
  // D-219: a task opens in the pane beside the view.
  const links = paneLinks(base, { ...query, created: undefined, view });
  const paneId = paneTaskId(query.task);
  // v1.62.0 (D-368): with "pm_foundations" on (and not on a phone), the task opens in the right-side pane at the person's width.
  const sideWidth = pmOn && paneId && !(await isMobileLayout()) ? clampPaneWidth(await getUserSetting(user.id, PANE_SETTING).catch(() => null)) : null;
  const pane = paneId ? <TaskPane taskId={paneId} user={user} closeHref={links.close} side={sideWidth ? { width: sideWidth } : null} /> : null;

  return (
    <>
      <ProjectHeader
        projectId={project.id}
        name={project.name}
        color={project.color}
        meta={`${PRIVACY_LABEL[project.privacy]}${project.departmentName ? ` · ${project.departmentName}` : ""} · You: ${PROJECT_ROLE_LABEL[role]} · ${counts.completed}/${counts.open + counts.completed} done${counts.overdue ? ` · ${counts.overdue} overdue` : ""}`}
        starred={starred}
        status={project.currentStatus}
        members={members.filter((member) => member.type === "USER").map((member) => ({ id: member.id, name: member.name }))}
        canEdit={can.edit}
        canManage={can.manage}
        share={{
          privacy: project.privacy,
          departmentId: project.departmentId,
          departments: shareDepartments,
          members,
          people: sharePeople,
          canShare: can.share,
        }}
      />
      {(project.archivedAt || (!isMember && !viewer.isAdmin)) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {project.archivedAt && <Badge tone="neutral">Archived</Badge>}
          {!isMember && !viewer.isAdmin && <ProjectCommandButton projectId={project.id} command="JOIN" label="Join project" />}
        </div>
      )}
      {query.created === "1" && (
        <p role="status" className="mb-4 rounded-md bg-success-50 px-3 py-2 text-label text-success-600">
          Project created. Add tasks below, and use Share to bring people in.
        </p>
      )}
      {project.archivedAt && <p className="mb-4 rounded-md bg-surface-muted px-3 py-2 text-label">This project is archived. Its tasks still work; it is hidden from the project list.</p>}
      <LiveRefresh />
      {pmOn && <ViewTabs projectId={project.id} base={base} strip={strip} activeKey={activeTab?.key ?? null} canEdit={can.edit} planning={planning} reporting={reporting} extras={extras} />}
      {!pmOn && (
      <nav aria-label="Project views" className="mb-3 flex flex-wrap gap-1 border-b border-line" data-testid="view-tabs">
        {VIEWS.map((item) => (
          <span key={item.key} className="contents">
            <Link
              href={`${base}?view=${item.key}`}
              aria-current={view === item.key && !currentTab ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-label ${view === item.key && !currentTab ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
            >
              {item.label}
            </Link>
            {item.key === "list" &&
              savedTabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={`${base}?view=list&tab=${tab.id}`}
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

      {planning && fields?.customise && <FieldDialogHost projectId={project.id} projectName={project.name} fields={fields.views} customiseRole={fields.customiseRole} planning />}
      <WithPane pane={pane} sideWidth={sideWidth}>
        {(view === "list" || view === "board") && (
          <ProjectWorkspace
            key={activeTab?.key ?? `${view}:${currentTab?.id ?? ""}`}
            projectId={project.id}
            layout={view === "board" ? "BOARD" : "LIST"}
            density={density}
            board={
              pmOn && view === "board" && activeTab
                ? { initial: parseTabConfig("BOARD", activeRow?.config) as BoardConfig, tabKey: activeTab.key, tabName: activeTab.name, canSave: can.edit }
                : undefined
            }
            sections={sections.map((section) => ({
              id: section.id,
              name: section.name,
            }))}
            tasks={tasks.map((task) => ({
              id: task.id,
              taskNo: task.taskNo,
              title: task.title,
              status: task.status,
              priority: task.priority,
              assigneeId: task.assigneeId,
              assigneeName: task.assigneeName,
              assigneeDepartment: task.assigneeDepartment ?? null,
              dueAt: task.dueAt?.toISOString() ?? null,
              sectionId: task.sectionId ?? sections[0]?.id ?? 0,
              position: task.position,
              subtasks: task.subtasks,
              subtasksOpen: task.subtasksOpen,
              comments: task.comments,
              likes: task.likes,
              blockedBy: task.blockedBy,
              isMilestone: task.isMilestone,
              isPeriodic: task.isPeriodic,
              approval: task.approval ?? null,
              tags: task.tags.map((tag) => ({ id: tag.id, name: tag.name })),
            }))}
            canEdit={can.edit}
            meId={user.id}
            people={people}
            nowIso={now.toISOString()}
            fields={fields?.views ?? []}
            values={values}
            planning={planning}
            customise={Boolean(planning && fields?.customise)}
            grid={
              view === "list"
                ? {
                    rows: tasks.map((task) => toGridTask(task, user.id, can.edit)),
                    subtasks: pmOn ? childrenByParent(subtaskRows.map((task) => ({ parentId: task.parentTaskId, row: toGridTask(task, user.id, can.edit) }))) : undefined,
                    initial: activeTab ? (parseTabConfig("LIST", activeRow?.config) as GridConfig) : currentTab ? parseGridConfig(currentTab.config) : { ...DEFAULT_GRID, group: "section" },
                    view: activeTab
                      ? { scope: "PROJECT", scopeId: project.id, canSave: can.edit, current: activeTab.id ? { id: activeTab.id, name: activeTab.name } : null, tabKey: activeTab.key, tabName: activeTab.name, phaseA: true }
                      : { scope: "PROJECT", scopeId: project.id, canSave: can.edit, current: currentTab ? { id: currentTab.id, name: currentTab.name } : null },
                  }
                : undefined
            }
          />
        )}
        {view === "calendar" && (
          <TaskCalendar
            tasks={tasks.map((task) => ({
              id: task.id,
              title: task.title,
              status: task.status,
              dueAt: task.dueAt?.toISOString() ?? null,
              assigneeId: task.assigneeId,
              isMilestone: task.isMilestone,
              startsOn: task.startsOn,
            }))}
            planning={planning ? { unit: query.cal === "week" ? "week" : "month", week: /^\d{4}-\d{2}-\d{2}$/.test(query.week ?? "") ? query.week! : todayDay, href: activeTab?.id ? `${base}?tab=${activeTab.id}&` : `${base}?view=calendar&` } : undefined}
            month={month}
            todayDay={todayDay}
            canEdit={can.edit}
            meId={user.id}
            projectId={project.id}
            monthHref={activeTab?.id ? `${base}?tab=${activeTab.id}&month=` : `${base}?view=calendar&month=`}
            holidays={await calendarHolidays(undefined, viewer.departmentId)}
          />
        )}
        {scheduleView && (
          <ScheduleView
            key={view}
            mode={view === "gantt" ? "GANTT" : "TIMELINE"}
            sections={sections.map((section) => ({ id: section.id, name: section.name }))}
            tasks={tasks
              .filter((task) => task.dueAt && task.status !== "CANCELLED")
              .map((task) => ({
                id: task.id,
                taskNo: task.taskNo,
                title: task.title,
                status: task.status,
                sectionId: task.sectionId ?? sections[0]?.id ?? 0,
                startsOn: task.startsOn,
                dueAt: task.dueAt!.toISOString(),
                isMilestone: task.isMilestone,
                assigneeId: task.assigneeId,
                assigneeName: task.assigneeName,
              }))}
            links={scheduleLinks}
            todayDay={todayDay}
            holidays={scheduleHolidays}
            workingWeekdays={workingWeekdays}
            canEdit={can.edit}
            meId={user.id}
          />
        )}
        {dashboard?.ok && <Dashboard key={activeTab?.key ?? "dashboard"} projectId={project.id} {...dashboard.value} />}
        {workload?.ok && <Workload projectId={project.id} data={workload.value} />}
        {(view === "dashboard" || view === "workload") && !reporting && <p className="card px-5 py-8 text-center text-ink-muted">The {view === "dashboard" ? "Dashboard" : "Workload"} view isn&apos;t switched on yet.</p>}
        {view === "gantt" && !planning && <p className="card px-5 py-8 text-center text-ink-muted">The Gantt view isn&apos;t switched on yet.</p>}
        {(view === "files" || view === "messages" || view === "page") && !extras && <p className="card px-5 py-8 text-center text-ink-muted">This view isn&apos;t switched on yet.</p>}
        {projectFiles?.ok && <FilesTab files={projectFiles.value} taskHref={`${links.open(0).replace(/task=0$/, "task=")}`} messagesHref={`${base}?view=messages&thread=`} />}
        {messages?.ok && (
          <MessagesTab
            key={activeTab?.key ?? "messages"}
            projectId={project.id}
            projectName={project.name}
            threads={messages.value.threads}
            replies={messages.value.replies}
            canWrite={messages.value.canWrite && !project.archivedAt}
            people={mentionList}
            openThread={/^\d{1,10}$/.test(query.thread ?? "") ? Number(query.thread) : null}
          />
        )}
        {page?.ok && <PageTab key={activeTab?.key ?? "page"} projectId={project.id} page={page.value} people={mentionList} tasks={tasks.map((task) => ({ id: task.id, taskNo: task.taskNo, title: task.title }))} taskHref={`${links.open(0).replace(/task=0$/, "task=")}`} />}
        {view === "timeline" && !planning && (
          <Timeline
            hrefFor={links.open}
            todayDay={todayDay}
            tasks={tasks.map((task) => ({
              id: task.id,
              title: task.title,
              status: task.status,
              sectionName: sectionName.get(task.sectionId ?? 0) ?? "",
              startsOn: task.startsOn,
              dueAt: task.dueAt?.toISOString() ?? null,
              isMilestone: task.isMilestone,
              blockedBy: task.blockedBy,
              assigneeName: task.assigneeName,
            }))}
          />
        )}
        {view === "overview" && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-6">
              <section className="card space-y-3 px-5 py-4" aria-labelledby="about">
                <h2 id="about" className="font-semibold">
                  About this project
                </h2>
                {project.description ? (
                  <p className="whitespace-pre-wrap">
                    <RichText text={project.description} />
                  </p>
                ) : (
                  <p className="text-ink-muted">No description yet.</p>
                )}
                <dl className="grid gap-3 sm:grid-cols-3">
                  <Fact label="Owner" value={project.ownerName} />
                  <Fact label="Starts" value={project.startOn ?? "—"} />
                  <Fact label="Due" value={project.dueOn ?? "—"} />
                  {timeTotals && <Fact label="Time logged" value={`${formatMinutes(timeTotals.logged)}${timeTotals.estimate ? ` of ${formatMinutes(timeTotals.estimate)} estimated` : ""}`} />}
                </dl>
                {timeTotals && (
                  <p className="text-caption text-ink-muted" data-testid="project-time">
                    Time on the tasks you can see{timeTotals.tasksWithEstimate ? ` (${timeTotals.tasksWithEstimate} with an estimate)` : ""}.{" "}
                    <a href={`/api/work/projects/${project.id}/time`} className="link" download>
                      Download time entries (CSV)
                    </a>
                  </p>
                )}
                <div>
                  <h3 className="text-label font-semibold">Milestones</h3>
                  <ul className="mt-1 space-y-1 text-label">
                    {tasks.filter((task) => task.isMilestone).length === 0 && <li className="text-ink-muted">None. Mark a task as a milestone from the task page.</li>}
                    {tasks
                      .filter((task) => task.isMilestone)
                      .map((task) => (
                        <li key={task.id}>
                          ◆{" "}
                          <Link href={`/users/tasks/${task.id}`} className="link">
                            {task.title}
                          </Link>{" "}
                          <span className="text-ink-muted">{task.dueAt ? indiaDayOf(task.dueAt) : "no date"}</span> {task.status === "COMPLETED" && <Badge tone="success">Done</Badge>}
                        </li>
                      ))}
                  </ul>
                </div>
              </section>
              <section className="card space-y-4 px-5 py-4" aria-labelledby="statuses">
                <h2 id="statuses" className="font-semibold">
                  Status updates
                </h2>
                {statuses.length === 0 && <p className="text-ink-muted">No status update yet.</p>}
                <ol className="space-y-4">
                  {statuses.map((update) => (
                    <li key={update.id} className="rounded-md border border-line p-3" data-testid="status-update">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={STATUS_KIND_TONE[update.status]}>{STATUS_KIND_LABEL[update.status]}</Badge>
                        <span className="font-medium">
                          <SafeText text={update.title} />
                        </span>
                        <span className="ml-auto text-caption text-ink-muted">
                          {update.authorName}, {indiaDateTimeText(update.createdAt)}
                        </span>
                        {update.authorId === user.id && <RemoveStatusButton statusId={update.id} />}
                      </div>
                      {(update.ownerName || update.startOn || update.dueOn) && (
                        <p className="mt-1 text-caption text-ink-muted">
                          {update.ownerName ? `Owner ${update.ownerName}` : ""}
                          {update.startOn || update.dueOn ? `${update.ownerName ? " · " : ""}Dates ${update.startOn ?? "—"} to ${update.dueOn ?? "—"}` : ""}
                        </p>
                      )}
                      {update.body && (
                        <>
                          {update.nextSteps && <h3 className="mt-2 text-label font-semibold">Summary</h3>}
                          <p className={`${update.nextSteps ? "" : "mt-2 "}whitespace-pre-wrap text-label`}>
                            <RichText text={update.body} />
                          </p>
                        </>
                      )}
                      {update.nextSteps && (
                        <>
                          <h3 className="mt-2 text-label font-semibold">Next steps</h3>
                          <p className="whitespace-pre-wrap text-label">
                            <RichText text={update.nextSteps} />
                          </p>
                        </>
                      )}
                      {update.highlights && update.highlights.length > 0 && (
                        <>
                          <h3 className="mt-2 text-label font-semibold">Highlights</h3>
                          <ul className="text-label" data-testid="status-highlights">
                            {update.highlights.map((item) => (
                              <li key={item.id}>
                                {item.milestone ? "◆ " : "✓ "}
                                {item.title} <span className="text-caption text-ink-muted">(done {item.completedOn})</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      <p className="mt-2 text-caption text-ink-muted">
                        When posted: {update.snapshot.open} open, {update.snapshot.completed} completed, {update.snapshot.overdue} overdue.{update.recipients ? ` ${update.recipients} ${update.recipients === 1 ? "person" : "people"} told.` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <aside className="space-y-4">
              {can.edit && !statusSetup && (
                <section className="card px-5 py-4" aria-label="Post a status update">
                  <h2 className="mb-3 font-semibold">Post a status update</h2>
                  {/* Keyed by the status chosen in the header, so choosing another one there selects it here. */}
                  <StatusForm key={typeof query.status === "string" ? query.status : "none"} projectId={project.id} initial={typeof query.status === "string" ? query.status : undefined} />
                </section>
              )}
              {can.edit && statusSetup && (
                <section className="card px-5 py-4" aria-label="Post a status update">
                  <h2 className="mb-3 font-semibold">Post a status update</h2>
                  {/* v1.65.0 (D-373): the fuller composer (sections, highlights, recipients, weekly reminder). */}
                  <StatusComposer
                    key={typeof query.status === "string" ? query.status : "none"}
                    projectId={project.id}
                    projectName={project.name}
                    initial={typeof query.status === "string" ? query.status : undefined}
                    todayDay={todayDay}
                    owner={{ id: project.ownerId, name: project.ownerName }}
                    members={members.filter((member) => member.type === "USER").map((member) => ({ id: member.id, name: member.name }))}
                    people={sharePeople}
                    startOn={project.startOn ?? ""}
                    dueOn={project.dueOn ?? ""}
                    reminder={statusSetup.statusReminder}
                    meId={user.id}
                  />
                </section>
              )}
              <section className="card px-5 py-4" aria-labelledby="people">
                <h2 id="people" className="mb-2 font-semibold">
                  Members
                </h2>
                <ul className="space-y-1 text-label">
                  {members.map((member) => (
                    <li key={`${member.type}:${member.id}`} className="flex justify-between gap-2">
                      <span>
                        {member.name}
                        {member.type === "DEPARTMENT" ? " (department)" : ""}
                      </span>
                      <span className="text-ink-muted">{PROJECT_ROLE_LABEL[member.role]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        )}
      </WithPane>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
