import { TaskPriorityPill } from "@/features/ui/ChoicePill";
import "server-only";
import { ApprovalBadge, approvalRowClass } from "@/features/work/ApprovalLink";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  FolderKanban,
  Layers,
  ListChecks,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Pencil,
  Search,
  Tag,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";
import { paneLinks, paneTaskId, TaskPane, WithPane } from "@/features/work/TaskPane";
import { CreateTaskButton, ProjectDot, TaskCheck } from "@/features/work/client";
import { Badge, type Tone } from "@/features/ui/Display";
import { dueLabel, indiaDayOf, TONE_TEXT } from "@/features/work/format";
import { homeProjects, listTaskItems, recentStatusUpdates, type StatusUpdate, type WorkTaskItem } from "@/lib/db/repositories/work.repository";
import { STATUS_KIND_LABEL, STATUS_KIND_TONE } from "@/server/work/access";
import { taskInsights, weeklyWorkload, workActivity, workSummary, type TaskInsights, type WorkActivity } from "@/lib/db/repositories/overview.repository";
import { personProfile } from "@/lib/db/repositories/profile.repository";
import { indiaDateTimeText } from "@/server/modules/settings";
import { changePercent, parsePeriod, PREVIOUS_LABEL } from "@/server/work/period";
import type { WorkViewer } from "@/server/work/access";
import type { workPage } from "@/server/work/page-context";
import { CreateTaskQuick, QuietRefresh, WorkloadChart } from "@/features/home/HomeClient";
import { AttentionWidget, InsightFigures, OverviewHeader, periodKeep, SummaryCards, type AttentionItem, type SummaryCard } from "@/features/home/OverviewParts";
import { WIDGETS_TOOLBAR_SLOT } from "@/features/home/QuickActions";
import { hasModule } from "@/server/modules/modules";
import { ComingSoonCard, ComingSoonChip, LockedProjectName } from "@/features/ui/ComingSoon";
import { SortTh } from "@/features/ui/SortTh";
import { nextDir, parseColumnSort, sqlDir } from "@/server/lists/sorting";
import { HomeWidgets } from "@/features/home/HomeWidgets";
import { HomeNotepad } from "@/features/home/HomeNotepad";
import { TeamWorkloadTable } from "@/features/work/TeamWorkloadTable";
import { teamWorkload } from "@/lib/db/repositories/work.repository";
import { sharePercent, type WidgetItem, type WidgetKind } from "@/server/home/widgets";
import { homeForms, type HomeForms } from "@/server/work/intake-forms";

// v1.63.0 (D-369, PM-A12): with "pm_foundations" on, Home's sections are the
// person's own widgets (order, width, which ones), plus the private notepad
// and People (the reporting line). The page passes the layout here.
export interface HomeWidgetSetup {
  layout: WidgetItem[];
  version: number;
  addable: { kind: WidgetKind; title: string; description: string }[];
  note: { body: string; version: number };
  given: React.ReactNode; // "Tasks I've assigned" (TaskHome part "given")
}

// D-265 (owner's My Work brief): Home → Task Management. Every figure is
// counted from the task records with the same rules as My Tasks (India days;
// overdue = due before today). Totals say what they cover: "open now" figures
// are not limited to the period; completed and assigned are.
const OPEN = "t.status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')";
const IST_DAY = "DATE(DATE_ADD(t.due_at, INTERVAL 330 MINUTE))";
const PAGE = 6;
// v1.58.0 (D-354, owner: "i need sorting in all the tables asc to desc or vice
// versa in all columns"): My Tasks' columns sort every page from their titles.
// Fixed SQL per column; empty values (no due date, no project) stay last.
const MW_COLUMNS = ["task", "project", "due", "priority", "status"] as const;
type MwColumn = (typeof MW_COLUMNS)[number];
const PROJECT_NAME = "(SELECT MIN(p.name) FROM task_projects tp JOIN projects p ON p.id = tp.project_id AND p.deleted_at IS NULL WHERE tp.task_id = t.id)";
function myWorkOrder(column: MwColumn, dir: "asc" | "desc"): string {
  const d = sqlDir(dir);
  switch (column) {
    case "task":
      return `t.title ${d}, t.id ${d}`;
    case "project":
      return `${PROJECT_NAME} IS NULL, ${PROJECT_NAME} ${d}, t.id ${d}`;
    case "due":
      return `t.due_at IS NULL, t.due_at ${d}, t.id ${d}`;
    case "priority":
      return `FIELD(t.priority, 'URGENT', 'HIGH', 'IMPORTANT', 'ELEVATED', 'NORMAL', 'LOW') ${d}, t.id ${d}`;
    case "status":
      return `FIELD(t.status, 'OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED') ${d}, t.id ${d}`;
  }
}
type Tab = "upcoming" | "overdue" | "completed" | "all";
const STATUS: Record<WorkTaskItem["status"], [string, Tone]> = {
  OPEN: ["Open", "info"],
  IN_PROGRESS: ["In progress", "primary"],
  BLOCKED: ["Blocked", "warning"],
  COMPLETED: ["Completed", "success"],
  CANCELLED: ["Cancelled", "neutral"],
};

export async function MyWorkOverview({
  user,
  viewer,
  query,
  switcher,
  others,
  widgets,
  greeting,
}: {
  user: Awaited<ReturnType<typeof workPage>>["user"];
  viewer: WorkViewer;
  query: Record<string, string | undefined>;
  switcher: React.ReactNode;
  others: React.ReactNode;
  widgets?: HomeWidgetSetup;
  greeting?: React.ReactNode;
}) {
  const now = new Date();
  const today = indiaDayOf(now);
  const period = parsePeriod(query, today, "week");
  const tab: Tab = query.tab === "overdue" || query.tab === "completed" || query.tab === "all" ? query.tab : "upcoming";
  const page = Math.max(1, Math.min(50, Number(query.tp) || 1));
  const mineBase = ["t.assignee_id = ?", "t.deleted_at IS NULL"];
  const completedIn = "(t.status = 'COMPLETED' AND t.completed_at >= ? AND t.completed_at < ?)";
  const tabWhere = (which: Tab): [string[], unknown[], string] =>
    which === "overdue"
      ? [[...mineBase, OPEN, "t.due_at IS NOT NULL", `${IST_DAY} < ?`], [user.id, today], "t.due_at"]
      : which === "completed"
        ? [[...mineBase, completedIn], [user.id, period.from, period.to], "t.completed_at DESC"]
        : which === "all"
          ? [[...mineBase, `(${OPEN} OR ${completedIn})`], [user.id, period.from, period.to], "t.status = 'COMPLETED', t.due_at IS NULL, t.due_at, t.id DESC"]
          : [[...mineBase, OPEN, "t.due_at IS NOT NULL", `${IST_DAY} >= ?`], [user.id, today], "t.due_at, t.id DESC"];
  const columnSort = parseColumnSort<MwColumn>(query, MW_COLUMNS);
  const sortedWhere = (which: Tab): [string[], unknown[], string] => {
    const [where, params, order] = tabWhere(which);
    return [where, params, columnSort.sortBy ? myWorkOrder(columnSort.sortBy, columnSort.dir) : order];
  };
  const limit = query.activity === "more" ? 20 : 6;
  // D-307 (owner): Projects is its own module. Without it, project cards are
  // locked ("Coming soon") and a task's project is its name only, no link.
  const projectsOn = hasModule(user, "PROJECT");
  // v1.63.0 (D-369): only the widgets on the person's Home load their data.
  const shown = (kind: WidgetKind) => !widgets || widgets.layout.some((item) => item.kind === kind);
  const projectScope = widgets && query.pw === "starred" ? "starred" : "recent";
  // v1.79.0 (D-406): the standard widgets (Needs attention, Quick insights), loaded only when shown.
  const attentionWanted = Boolean(widgets) && shown("task_attention");
  const insightsWanted = Boolean(widgets) && shown("task_insights");
  const [summary, list, projectRows, taskEvents, statusPosts, workload, profile, team, attentionList, insights] = await Promise.all([
    workSummary(user.id, today, period),
    shown("my_tasks") ? listTaskItems(...sortedWhere(tab), PAGE, (page - 1) * PAGE) : Promise.resolve({ items: [] as WorkTaskItem[], total: 0 }),
    projectsOn && shown("projects") ? homeProjects(viewer, widgets ? 40 : 4) : Promise.resolve([]),
    shown("status_updates") ? workActivity(user.id, limit) : Promise.resolve([] as WorkActivity[]),
    projectsOn && shown("status_updates") ? recentStatusUpdates(viewer, limit) : Promise.resolve([] as StatusUpdate[]),
    shown("workload") ? weeklyWorkload(user.id, period) : Promise.resolve({ assigned: [] as number[], completed: [] as number[] }),
    personProfile(user.id).catch(() => null),
    widgets && shown("people") ? teamWorkload(viewer.teamIds, user.id) : Promise.resolve([]),
    attentionWanted ? listTaskItems([...mineBase, OPEN, "t.due_at IS NOT NULL", `${IST_DAY} <= ?`], [user.id, today], "t.due_at, t.id", 10, 0) : Promise.resolve({ items: [] as WorkTaskItem[], total: 0 }),
    insightsWanted ? taskInsights(user.id, period).catch(() => null) : Promise.resolve(null as TaskInsights | null),
  ]);
  // v1.66.0 (D-374): the Forms widget: forms the person may submit, and their recent submissions.
  const formsData: HomeForms | null = widgets && shown("forms") ? await homeForms({ id: user.id, name: user.name, roles: user.roles, modules: user.modules }).catch(() => null) : null;
  // Projects widget (spec §3.7): Recent (last opened first) or Starred.
  const projects = !widgets
    ? projectRows
    : projectScope === "starred"
      ? projectRows.filter((project) => project.starred).slice(0, 6)
      : [...projectRows].sort((a, b) => (b.recentAt?.getTime() ?? 0) - (a.recentAt?.getTime() ?? 0)).slice(0, 6);
  // The timeline: task events and project status posts, newest first.
  const activity: ({ kind: "task"; event: WorkActivity } | { kind: "status"; update: StatusUpdate })[] = [
    ...taskEvents.map((event) => ({ kind: "task" as const, event })),
    ...statusPosts.map((update) => ({ kind: "status" as const, update })),
  ]
    .sort((a, b) => (b.kind === "task" ? b.event.createdAt : b.update.createdAt).getTime() - (a.kind === "task" ? a.event.createdAt : a.update.createdAt).getTime())
    .slice(0, limit);
  const total = summary.open + summary.completed;
  const counts: Record<Tab, number> = { upcoming: summary.upcoming, overdue: summary.overdue, completed: summary.completed, all: total };
  const keep: Record<string, string> = {
    home: "tasks",
    ...periodKeep(period, "week"),
    ...(columnSort.sortBy ? { sortBy: columnSort.sortBy, dir: columnSort.dir } : {}), // v1.58.0 (D-354)
  };
  const mwSort = (column: MwColumn, label: string) => (
    <SortTh label={label} column={column} sortBy={columnSort.sortBy} dir={columnSort.dir} href={`/users?${new URLSearchParams({ ...keep, tab, sortBy: column, dir: nextDir(columnSort, column) })}`} className="py-2 pr-3 font-medium" />
  );
  const href = (extra: Record<string, string>) => `/users?${new URLSearchParams({ ...keep, tab, ...extra })}`;
  const links = paneLinks("/users", { ...keep, tab, ...(page > 1 ? { tp: String(page) } : {}) });
  const paneId = paneTaskId(query.task);
  const pane = paneId ? <TaskPane taskId={paneId} user={user} closeHref={links.close} /> : null;
  const pages = Math.max(1, Math.ceil(list.total / PAGE));
  const role = [profile?.designationName, profile?.departmentName].filter(Boolean).join(" · ");

  const cards: SummaryCard[] = [
    {
      key: "total",
      label: "Total tasks",
      note: `open now + done ${period.label.toLowerCase()}`,
      value: total,
      icon: ListChecks,
      tone: "bg-primary-50 text-primary-700",
      href: "/users/work/my-tasks",
    },
    {
      key: "upcoming",
      label: "Upcoming",
      note: "open, due today or later",
      value: summary.upcoming,
      icon: Clock3,
      tone: "bg-[color:var(--violet-bg)] text-[color:var(--violet-fg)]",
      href: `/users/work/search?assignee=me&due_from=${today}`,
    },
    {
      key: "overdue",
      label: "Overdue",
      note: "open, past their due date",
      value: summary.overdue,
      icon: AlertTriangle,
      tone: "bg-warning-50 text-warning-600",
      href: "/users/work/search?assignee=me&overdue=1",
    },
    {
      key: "completed",
      label: "Completed",
      note: period.label,
      value: summary.completed,
      icon: CheckCircle2,
      tone: "bg-success-50 text-success-600",
      href: "/users/work/search?assignee=me&status=completed",
      change: { value: changePercent(summary.completed, summary.completedBefore), label: PREVIOUS_LABEL[period.key] },
    },
  ];
  // v1.79.0 (D-406): Needs attention on My Work: overdue tasks first, then those due today.
  const attentionItems: AttentionItem[] = attentionList.items.map((task) => {
    const late = task.dueAt ? indiaDayOf(task.dueAt) < today : false;
    return { key: `t${task.id}`, text: late ? "Overdue task" : "Due today", detail: `${task.title}${task.projects[0] ? ` · ${task.projects[0].name}` : ""}`, href: links.open(task.id), danger: late };
  });
  const attentionNode = <AttentionWidget id="mw-attention" items={attentionItems} empty="Nothing overdue or due today. Well done." testId="task-attention" />;
  const insightsNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="mw-insights" data-testid="task-insights">
      <h2 id="mw-insights" className="mb-3 flex items-center gap-2 text-[calc(17px*var(--text-scale,1))] font-semibold">
        <BarChart3 aria-hidden="true" className="h-5 w-5 text-primary-700" /> Quick insights
      </h2>
      {insights === null ? (
        <p className="text-label text-ink-muted">Insights couldn&apos;t be worked out just now. Reload the page to try again.</p>
      ) : (
        <>
          <InsightFigures
            figures={[
              { icon: <CheckCircle2 className="h-5 w-5" />, tone: "text-success-600", label: "Completion rate", value: pct(sharePercent(insights.givenDone, insights.given)) },
              { icon: <Clock3 className="h-5 w-5" />, tone: "text-primary-700", label: "On time", value: pct(sharePercent(insights.onTime, insights.withDue)) },
              { icon: <Timer className="h-5 w-5" />, tone: "text-[color:var(--violet-fg)]", label: "Avg. days to complete", value: insights.avgDays === null ? "N/A" : insights.avgDays < 1 ? "< 1" : insights.avgDays.toFixed(1) },
            ]}
          />
          <p className="mt-2 text-caption text-ink-muted">
            {period.label}: {insights.givenDone} of {insights.given} task{insights.given === 1 ? "" : "s"} given to you are completed; {insights.onTime} of {insights.withDue} completed with a due date were on time. Days are from being given the task to completing it.
          </p>
        </>
      )}
    </section>
  );

  const myTasksNode = (
          <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="mw-tasks">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="mw-tasks" className="text-[calc(17px*var(--text-scale,1))] font-semibold">
                My Tasks
              </h2>
              <span className="flex items-center gap-3">
                <CreateTaskButton />
                <Link href="/users/work/my-tasks" className="link inline-flex items-center gap-1 text-label">
                  View all <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </span>
            </div>
            <nav aria-label="My tasks" className="mb-2 flex gap-1 overflow-x-auto border-b border-line">
              {(
                [
                  ["upcoming", "Upcoming"],
                  ["overdue", "Overdue"],
                  ["completed", "Completed"],
                  ["all", "All"],
                ] as [Tab, string][]
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={`/users?${new URLSearchParams({ ...keep, tab: key })}`}
                  scroll={false}
                  aria-current={tab === key ? "page" : undefined}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-label ${tab === key ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                  {label} ({counts[key]})
                </Link>
              ))}
            </nav>
            {list.items.length === 0 ? (
              <p className="py-8 text-center text-label text-ink-muted" data-testid="mw-empty">
                {tab === "overdue"
                  ? "Nothing overdue. Well done."
                  : tab === "completed"
                    ? `Nothing completed ${period.label.toLowerCase()}.`
                    : tab === "upcoming"
                      ? "Nothing upcoming with a due date."
                      : "No tasks given to you."}
              </p>
            ) : (
              <>
                {/* v1.74.1 (D-397): the table from 1024 px; on a tablet with the menu open it ran past the card (cards instead). */}
                <table className="hidden w-full text-label lg:table" data-testid="mw-table">
                  <caption className="sr-only">My tasks: {tab}</caption>
                  <thead className="text-left text-caption text-ink-muted">
                    <tr className="border-b border-line">
                      <th scope="col" className="w-8 py-2" />
                      {mwSort("task", "Task")}
                      {mwSort("project", "Project")}
                      {mwSort("due", "Due date")}
                      {mwSort("priority", "Priority")}
                      {mwSort("status", "Status")}
                      <th scope="col" className="py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {list.items.map((task) => (
                      <tr key={task.id} className={approvalRowClass(task.approval)}>
                        <td className="py-2.5">
                          <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={task.assigneeId !== user.id || task.status === "CANCELLED"} label={task.title} />
                        </td>
                        <td className="min-w-0 py-2.5 pr-3">
                          <Link href={links.open(task.id)} scroll={false} className="block font-semibold hover:underline">
                            {task.title}
                          </Link>
                          {task.approval && (
                            <span className="mt-0.5 block">
                              <ApprovalBadge approval={task.approval} size="sm" />
                            </span>
                          )}
                          {task.summary && <span className="line-clamp-1 text-caption text-ink-muted">{task.summary}</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          <ProjectChip task={task} on={projectsOn} />
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-3">
                          <Due task={task} now={now} />
                        </td>
                        <td className="py-2.5 pr-3">
                          <TaskPriorityPill priority={task.priority} showNormal />
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusBadge task={task} today={today} />
                        </td>
                        <td className="py-2.5 text-right">
                          <RowMenu task={task} openHref={links.open(task.id)} projectsOn={projectsOn} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Phones and tablets: cards instead of a squeezed table. */}
                <ul className="divide-y divide-line lg:hidden" data-testid="mw-cards">
                  {list.items.map((task) => (
                    <li key={task.id} className={`flex gap-3 py-3 ${approvalRowClass(task.approval)}`}>
                      <TaskCheck taskId={task.id} done={task.status === "COMPLETED"} disabled={task.assigneeId !== user.id || task.status === "CANCELLED"} label={task.title} />
                      <div className="min-w-0 flex-1">
                        <Link href={links.open(task.id)} scroll={false} className="block font-semibold [overflow-wrap:anywhere] hover:underline">
                          {task.title}
                        </Link>
                        {task.summary && <p className="line-clamp-2 text-caption text-ink-muted">{task.summary}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <ApprovalBadge approval={task.approval} size="sm" />
                          <ProjectChip task={task} on={projectsOn} />
                          <Due task={task} now={now} />
                          <TaskPriorityPill priority={task.priority} showNormal />
                          <StatusBadge task={task} today={today} />
                        </div>
                      </div>
                      <RowMenu task={task} openHref={links.open(task.id)} projectsOn={projectsOn} />
                    </li>
                  ))}
                </ul>
                {pages > 1 && (
                  <nav aria-label="My tasks pages" className="mt-3 flex items-center justify-between text-label">
                    <span className="text-ink-muted">
                      Page {page} of {pages} · {list.total} tasks
                    </span>
                    <span className="flex gap-2">
                      {page > 1 && (
                        <Link href={href({ tp: String(page - 1) })} scroll={false} className="btn-secondary btn-compact">
                          Previous
                        </Link>
                      )}
                      {page < pages && (
                        <Link href={href({ tp: String(page + 1) })} scroll={false} className="btn-secondary btn-compact">
                          Next
                        </Link>
                      )}
                    </span>
                  </nav>
                )}
              </>
            )}
          </section>
  );
  const projectsNode = !projectsOn ? (
            <ComingSoonCard title="Projects" body="Projects will open here once it is released for you." lines={4} testId="mw-projects-soon" />
          ) : (
          <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="mw-projects">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="mw-projects" className="text-[calc(17px*var(--text-scale,1))] font-semibold">
                Projects
              </h2>
              <Link href="/users/work/projects" className="link inline-flex items-center gap-1 text-label">
                All projects <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
            {widgets && (
              <nav aria-label="Which projects" className="mb-3 flex gap-1 border-b border-line" data-testid="projects-scope">
                {(
                  [
                    ["recent", "Recent"],
                    ["starred", "Starred"],
                  ] as const
                ).map(([key, label]) => (
                  <Link
                    key={key}
                    href={href(key === "starred" ? { pw: "starred" } : {})}
                    scroll={false}
                    aria-current={projectScope === key ? "page" : undefined}
                    className={`-mb-px border-b-2 px-3 py-1.5 text-label ${projectScope === key ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            )}
            {projects.length === 0 && projectScope === "starred" ? (
              <p className="py-6 text-center text-label text-ink-muted">No starred projects. Star a project from its header to keep it here.</p>
            ) : projects.length === 0 ? (
              <div className="py-6 text-center text-label text-ink-muted">
                <p>No projects yet.</p>
                <Link href="/users/work/projects/new" className="link">
                  Create a project
                </Link>
              </div>
            ) : (
              <ul className="space-y-3" data-testid="mw-project-list">
                {projects.map((project) => {
                  const all = project.openTasks + project.doneTasks;
                  const percent = all ? Math.round((project.doneTasks / all) * 100) : 0;
                  return (
                    <li key={project.id}>
                      <Link href={`/users/work/projects/${project.id}`} className="block rounded-lg border border-line px-3 py-3 hover:bg-surface-muted">
                        <span className="flex items-center gap-3">
                          <ProjectDot color={project.color} className="h-3 w-3" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{project.name}</span>
                            <span className="block text-caption text-ink-muted">
                              {all} tasks · {project.doneTasks} completed · {project.openTasks} pending
                            </span>
                          </span>
                          <Ring percent={percent} />
                        </span>
                        <span
                          className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line"
                          role="progressbar"
                          aria-label={`${project.name} progress`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                        >
                          <span className="block h-full rounded-full bg-success-solid" style={{ width: `${percent}%` }} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          );
  const activityNode = (
          <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="mw-activity">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="mw-activity" className="text-[calc(17px*var(--text-scale,1))] font-semibold">
                Latest status updates
              </h2>
              {query.activity !== "more" && activity.length >= 6 && (
                <Link href={href({ activity: "more" })} scroll={false} className="link inline-flex items-center gap-1 text-label">
                  View all <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              )}
            </div>
            {activity.length === 0 ? (
              <p className="py-6 text-center text-label text-ink-muted">No activity on your tasks yet.</p>
            ) : (
              <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-line" data-testid="mw-activity-list">
                {activity.map((item) => {
                  if (item.kind === "status")
                    return (
                      <li key={`s${item.update.id}`} className="relative flex gap-3">
                        <span
                          className="relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-50 text-primary-700 ring-4 ring-[color:var(--color-surface)]"
                          aria-hidden="true"
                        >
                          <FolderKanban className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="font-semibold">
                              Project status <Badge tone={STATUS_KIND_TONE[item.update.status]}>{STATUS_KIND_LABEL[item.update.status]}</Badge>
                            </span>
                            <span className="text-caption text-ink-muted">{indiaDateTimeText(item.update.createdAt)}</span>
                          </p>
                          <p className="text-label text-ink-muted [overflow-wrap:anywhere]">
                            <Link href={`/users/work/projects/${item.update.projectId}?view=overview`} className="link">
                              {item.update.projectName}
                            </Link>
                            : {item.update.title} · by {item.update.authorId === user.id ? "you" : item.update.authorName}
                          </p>
                        </div>
                      </li>
                    );
                  const event = item.event;
                  const shown = describe(event, user.id);
                  return (
                    <li key={`t${event.id}`} className="relative flex gap-3">
                      <span className={`relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full ring-4 ring-[color:var(--color-surface)] ${shown.tone}`} aria-hidden="true">
                        <shown.icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="font-semibold">{shown.title}</span>
                          <span className="text-caption text-ink-muted">{indiaDateTimeText(event.createdAt)}</span>
                        </p>
                        <p className="text-label text-ink-muted [overflow-wrap:anywhere]">
                          <Link href={links.open(event.taskId)} scroll={false} className="link">
                            “{event.taskTitle}”
                          </Link>{" "}
                          {shown.text}
                          {event.actorName && event.actorId !== user.id ? ` · by ${event.actorName}` : event.actorId === user.id ? " · by you" : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
  );
  // v1.63.0 (D-369): People, the person's reporting line (spec §3.9, our
  // version: who they report to, and everyone below them with their tasks).
  const peopleNode = (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="mw-people" data-testid="people-widget">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="mw-people" className="text-[calc(17px*var(--text-scale,1))] font-semibold">
          People
        </h2>
        {team.length > 0 && (
          <span className="flex gap-3 text-label">
            <Link href="/users/work/search?team=1" className="link">
              Their open tasks
            </Link>
            <Link href="/users/work/search?team=1&overdue=1" className="link">
              Overdue
            </Link>
          </span>
        )}
      </div>
      <p className="mb-2 text-label text-ink-muted">
        {profile?.managerName ? (
          <>
            You report to <span className="font-medium text-ink">{profile.managerName}</span>
            {profile.managerDesignation ? ` (${profile.managerDesignation})` : ""}.
          </>
        ) : (
          "No reporting manager is set for you."
        )}{" "}
        {team.length > 0 ? `${team.length} ${team.length === 1 ? "person is" : "people are"} below you in the reporting line.` : "Nobody reports to you."}
      </p>
      {team.length > 0 && (
        <div className="overflow-x-auto">
          <TeamWorkloadTable rows={team} />
        </div>
      )}
    </section>
  );
  const nodeFor = (kind: WidgetKind): React.ReactNode => {
    switch (kind) {
      case "my_tasks":
        return myTasksNode;
      case "projects":
        return projectsNode;
      case "status_updates":
        return activityNode;
      case "workload":
        return workloadNode;
      case "assigned":
        return widgets?.given ?? null;
      case "people":
        return peopleNode;
      case "notepad":
        return widgets ? <HomeNotepad initialText={widgets.note.body} version={widgets.note.version} /> : null;
      case "forms":
        return formsData ? <FormsWidget data={formsData} /> : null;
      case "task_attention":
        return attentionNode;
      case "task_insights":
        return insightsNode;
      default:
        return null;
    }
  };
  const workloadNode = (
          <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="mw-workload">
            <h2 id="mw-workload" className="mb-1 text-[calc(17px*var(--text-scale,1))] font-semibold">
              My weekly workload
            </h2>
            <p className="mb-2 text-caption text-ink-muted">
              {period.key === "week" ? "This week, day by day" : `${period.label}, by day of the week`}: tasks given to you and tasks you completed (by when they were done).
            </p>
            <WorkloadChart assigned={workload.assigned} completed={workload.completed} caption={`Tasks assigned and completed by day, ${period.label.toLowerCase()}`} />
          </section>
  );
  return (
    <div data-testid="my-work-overview">
      <QuietRefresh />
      {/* v1.79.0 (D-406): the header every overview shares. */}
      <OverviewHeader
        icon={Layers}
        title="My Work – Overview"
        role={greeting ? role : `Welcome back, ${user.name}${role ? ` · ${role}` : ""}`}
        description="Your tasks, projects and recent updates in one place."
        greeting={greeting}
        switcher={switcher}
        period={period}
        periodBase={{ home: "tasks", tab }}
      />

      <nav aria-label="Quick actions" className="mb-5 flex flex-wrap gap-2" data-testid="work-quick-actions">
        <CreateTaskQuick />
        <QuickLink href="/users/work/my-tasks" icon={<ListChecks className="h-4 w-4" />} label="View all tasks" />
        {projectsOn ? <QuickLink href="/users/work/projects" icon={<FolderKanban className="h-4 w-4" />} label="Projects" /> : <ComingSoonChip label="Projects" className="rounded-lg border border-line" />}
        <QuickLink href="/users/work/search" icon={<Search className="h-4 w-4" />} label="Search tasks" />
        <QuickLink href="/users/calendar" icon={<CalendarDays className="h-4 w-4" />} label="Calendar" />
        {/* v1.77.1 (owner, 22 Nov 2026): Add widgets and Customise sit at the right end of this row (HomeWidgets renders them here through a portal). */}
        {widgets && <div id={WIDGETS_TOOLBAR_SLOT} className="ml-auto flex flex-wrap items-center gap-2" />}
      </nav>

      <SummaryCards cards={cards} testId="work-kpis" cardTestId="work-kpi" />

      <WithPane pane={pane}>
        {widgets ? (
          <div className="mt-6">
          <HomeWidgets
            version={widgets.version}
            addable={widgets.addable}
            scope="tasks"
            widgets={widgets.layout.map((item) => ({ kind: item.kind, size: item.size, node: nodeFor(item.kind) }))}
            extra={!projectsOn ? projectsNode : undefined}
          />
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              {myTasksNode}
              {projectsNode}
              {activityNode}
              {workloadNode}
            </div>
            {others}
          </>
        )}
      </WithPane>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="btn-secondary btn-compact inline-flex items-center gap-1.5">
      <span aria-hidden="true">{icon}</span>
      {label}
    </Link>
  );
}

const pct = (value: number | null) => (value === null ? "N/A" : `${value}%`);

function ProjectChip({ task, on }: { task: WorkTaskItem; on: boolean }) {
  const project = task.projects[0];
  if (!project) return <span className="text-caption text-ink-faint">—</span>;
  if (!on) return <LockedProjectName name={project.name} className="max-w-[12rem] text-caption" />;
  return (
    <Link href={`/users/work/projects/${project.id}`} className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-caption hover:bg-surface-muted">
      <ProjectDot color={project.color} />
      <span className="truncate">{project.name}</span>
    </Link>
  );
}

function Due({ task, now }: { task: WorkTaskItem; now: Date }) {
  const open = ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(task.status);
  const due = dueLabel(task.dueAt, now, open);
  if (!due) return <span className="text-caption text-ink-faint">No due date</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-caption ${TONE_TEXT[due.tone]}`}>
      <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
      {due.text}
    </span>
  );
}

// Open tasks read as Upcoming / Overdue (the same days as the cards); the rest keep their status.
function StatusBadge({ task, today }: { task: WorkTaskItem; today: string }) {
  const open = ["OPEN", "IN_PROGRESS", "BLOCKED"].includes(task.status);
  if (open && task.status !== "BLOCKED" && task.dueAt) {
    const late = indiaDayOf(task.dueAt) < today;
    return <Badge tone={late ? "danger" : "info"}>{late ? "Overdue" : task.status === "IN_PROGRESS" ? "In progress" : "Upcoming"}</Badge>;
  }
  return <Badge tone={STATUS[task.status][1]}>{STATUS[task.status][0]}</Badge>;
}

function RowMenu({ task, openHref, projectsOn }: { task: WorkTaskItem; openHref: string; projectsOn: boolean }) {
  return (
    <details className="relative inline-block text-left">
      <summary
        className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-ink-muted hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
        aria-label={`Actions for ${task.title}`}
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 z-popover mt-1 w-52 rounded-lg border border-line bg-raised p-1 text-label shadow-overlay">
        <Link href={openHref} scroll={false} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-muted">
          <CircleDot aria-hidden="true" className="h-4 w-4" /> Open task
        </Link>
        <Link href={openHref} scroll={false} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-muted">
          <Pencil aria-hidden="true" className="h-4 w-4" /> Edit, reassign or change due date
        </Link>
        {projectsOn && task.projects[0] && (
          <Link href={`/users/work/projects/${task.projects[0].id}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-muted">
            <FolderKanban aria-hidden="true" className="h-4 w-4" /> Go to {task.projects[0].name}
          </Link>
        )}
      </div>
    </details>
  );
}

function Ring({ percent }: { percent: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--color-border)" strokeWidth="4" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="var(--road-done)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(percent / 100) * c} ${c}`} />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums">{percent}%</span>
    </span>
  );
}

// What an event says on the timeline (task_events types, D-150 / D-215).
function describe(event: WorkActivity, meId: number): { title: string; text: string; icon: typeof CheckCircle2; tone: string } {
  const p = event.payload ?? {};
  const blue = "bg-primary-50 text-primary-700";
  const green = "bg-success-50 text-success-600";
  const amber = "bg-warning-50 text-warning-600";
  const violet = "bg-[color:var(--violet-bg)] text-[color:var(--violet-fg)]";
  switch (event.type) {
    case "CREATED":
      return Number(p.assigneeId) === meId && event.actorId !== meId
        ? { title: "New task assigned", text: "was assigned to you.", icon: UserPlus, tone: blue }
        : { title: "Task created", text: "was created.", icon: ListChecks, tone: blue };
    case "REASSIGN":
      return Number(p.to) === meId
        ? { title: "Task assigned to you", text: "was reassigned to you.", icon: UserPlus, tone: blue }
        : { title: "Task reassigned", text: "was given to someone else.", icon: Users, tone: violet };
    case "COMPLETE":
      return { title: "Task completed", text: "was marked as completed.", icon: CheckCircle2, tone: green };
    case "REOPEN":
      return { title: "Task reopened", text: "was reopened.", icon: CircleDot, tone: amber };
    case "START":
      return { title: "Task started", text: "is in progress.", icon: CircleDot, tone: blue };
    case "BLOCK":
      return { title: "Task blocked", text: event.body ? `is blocked: ${event.body}` : "is blocked.", icon: AlertTriangle, tone: amber };
    case "UNBLOCK":
      return { title: "Task unblocked", text: "can go ahead again.", icon: CircleDot, tone: green };
    case "CANCEL":
    case "DELETED":
      return { title: "Task cancelled", text: "was cancelled.", icon: Minus, tone: amber };
    case "EDIT":
      return p.dueChanged
        ? { title: "Due date changed", text: event.body ? `· ${event.body}` : "has a new due date.", icon: CalendarClock, tone: amber }
        : { title: "Task updated", text: event.body ? `· ${event.body}` : "was changed.", icon: Pencil, tone: blue };
    case "COMMENT":
    case "COMMENTED":
      return { title: "New comment", text: event.body ? `· “${event.body.slice(0, 120)}”` : "has a new comment.", icon: MessageSquare, tone: violet };
    case "ADDED_TO_PROJECT":
      return { title: "Added to project", text: event.body ? `was added to ${event.body}.` : "was added to a project.", icon: FolderKanban, tone: violet };
    case "REMOVED_FROM_PROJECT":
      return { title: "Removed from project", text: event.body ? `was taken out of ${event.body}.` : "was taken out of a project.", icon: FolderKanban, tone: amber };
    case "FOLLOWER_ADDED":
      return { title: "Collaborator added", text: Number(p.userId) === meId ? "· you now follow it." : "has a new collaborator.", icon: Users, tone: violet };
    case "FOLLOWER_REMOVED":
      return { title: "Collaborator removed", text: "lost a collaborator.", icon: Users, tone: amber };
    case "TAG_ADDED":
    case "TAG_REMOVED":
      return { title: event.type === "TAG_ADDED" ? "Tag added" : "Tag removed", text: event.body ? `#${event.body}` : "", icon: Tag, tone: blue };
    case "DEPENDENCY_ADDED":
    case "DEPENDENCY_REMOVED":
      return { title: event.type === "DEPENDENCY_ADDED" ? "Now waiting on another task" : "No longer waiting", text: event.body ?? "", icon: Clock3, tone: amber };
    default:
      return { title: "Task updated", text: event.body ?? "", icon: Pencil, tone: blue };
  }
}

// v1.66.0 (D-374, spec HOME_MODULE §3.6 / FORMS_MODULE §3.1): forms the person
// may submit (published forms of live projects whose "who may submit" lets
// them in) and their latest submissions, each with its task when they can see it.
function FormsWidget({ data }: { data: HomeForms }) {
  return (
    <section className="card min-w-0 px-4 py-4 sm:px-5" aria-labelledby="mw-forms" data-testid="forms-widget">
      <h2 id="mw-forms" className="mb-2 text-[calc(17px*var(--text-scale,1))] font-semibold">
        Forms
      </h2>
      {data.forms.length === 0 ? (
        <p className="text-label text-ink-muted">No forms to fill in yet. A project&apos;s owners and editors add them in the project&apos;s settings (Customize → Forms).</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Forms you can submit">
          {data.forms.map((form) => (
            <li key={form.link} className="flex items-center gap-2 py-2 text-label">
              <span className="min-w-0 flex-1">
                <Link href={form.link} className="link font-medium">
                  {form.name}
                </Link>
                <span className="block truncate text-caption text-ink-muted">{form.projectName}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.mine.length > 0 && (
        <>
          <h3 className="mb-1 mt-3 text-label font-semibold">Your recent submissions</h3>
          <ul className="space-y-1 text-label" aria-label="Your recent submissions">
            {data.mine.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                {item.taskId && item.taskNo ? (
                  <Link href={`/users/tasks/${item.taskId}`} className="link">
                    {item.taskNo} {item.taskTitle}
                  </Link>
                ) : (
                  <span>{item.formName}</span>
                )}
                <span className="text-caption text-ink-muted">
                  {item.formName} · {indiaDateTimeText(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
