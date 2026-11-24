import { indiaHour } from "@/lib/format/date";
import { ListSkeleton } from "@/features/ui/Skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { displayName } from "@/features/shell/AppShell";
import { FirstUseChecklist } from "@/features/help/FirstUseChecklist";
import { hasFlag } from "@/lib/db/repositories/user-flags.repository";
import { hasModule, MODULE_LABEL, MODULES } from "@/server/modules/modules";
import { ComingSoonCard, ComingSoonChip } from "@/features/ui/ComingSoon";
import { getUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { parseWorkspaceView, WORKSPACE_VIEW_SETTING } from "@/server/ui/workspace-view";
import { ClassicGateway } from "@/features/shell/ClassicScreens";
import { featureOn } from "@/server/settings/features";
import { isMobileLayout } from "@/server/ui/layout-mode";
import { MobileHome } from "@/features/mobile/MobileHome";
import { isHiddenHref, navAccess } from "@/server/authorization/page-access";
import { workViewer } from "@/server/work/task-access";
import { TaskHome } from "@/features/work/TaskHome";
import { MyWorkOverview, type HomeWidgetSetup } from "@/features/home/MyWorkOverview";
import { HomeGreeting } from "@/features/home/HomeGreeting";
import { homeAccess, homeLayoutFor, overviewWidgets } from "@/server/home/home-service";
import { ApprovalOverview } from "@/features/home/ApprovalOverview";
import { addableWidgets } from "@/server/home/widgets";
import { getHomeNote } from "@/lib/db/repositories/home.repository";
import { MeetingHome } from "@/features/meetings/MeetingHome";
import { isApproverForHome } from "@/lib/db/repositories/overview.repository";
import { BarChart3, CalendarClock, CalendarDays, CalendarPlus, CheckCircle2, ClipboardCheck, FileEdit, FilePlus2, FileText, Inbox, ListChecks, Search, UserCheck } from "lucide-react";
import type { QuickAction } from "@/features/home/QuickActions";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Home" };

// My Work (S9-11, spec #1): the next thing to do first. Every list uses the
// same access rules as its full page (Waiting for me, My requests) and is
// bounded; each section links to that page.
// D-264 (owner): Home shows one area at a time, Approvals or Task Management,
// chosen at the top (?home=). D-265 (owner): approvers start on Approvals,
// everyone else on Task Management; either can switch.
type HomeFocus = "approvals" | "tasks" | "meetings";

export default async function UsersHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await requireArea("users");
  // D-210: in the Classic view the first screen is the Gateway; the Overview
  // dashboard is one of its entries (?view=overview).
  const query = await searchParams;
  // v1.43.0: phones get the mobile Home (features/mobile/MobileHome.tsx).
  if (await isMobileLayout()) {
    const access = await navAccess(user);
    const open = (href: string) => !isHiddenHref(href, access.hidden);
    const words = displayName(user.name).split(/\s+/);
    return (
      <MobileHome
        user={user}
        greeting={`${greetingFor(new Date())}, ${words.length <= 2 ? words.join(" ") : words[0]}`}
        approvals={hasModule(user, "APPROVAL") && (open("/users/queue") || open("/users/requests"))}
        tasks={(await featureOn("tasks", user).catch(() => false)) && open("/users/work")}
        can={{ newRequest: open("/users/custom") || open("/users/new"), newRequestHref: open("/users/custom") ? "/users/custom" : "/users/new", search: open("/users/search"), ai: (await featureOn("ai", user).catch(() => false)) && open("/users/ai/assistant") }}
        soon={MODULES.filter((module) => !hasModule(user, module)).map((module) => MODULE_LABEL[module])}
      />
    );
  }
  if (query.view !== "overview" && !query.tour && parseWorkspaceView(await getUserSetting(user.id, WORKSPACE_VIEW_SETTING).catch(() => null)) === "CLASSIC") return <ClassicGateway user={user} />;
  // D-236 (owner): Home holds the Task home too, for people who have Tasks
  // and may open its pages.
  const tasksOn = (await featureOn("tasks", user).catch(() => false)) && !isHiddenHref("/users/work", (await navAccess(user)).hidden);
  // D-168: without the Approval module the page offers the person's other modules.
  // v1.65.0 (D-373, PM-A14): with "pm_foundations" on, their Task home is the same
  // widget board as Task Management's Home (D-369): greeting, widgets, Customise.
  if (!hasModule(user, "APPROVAL") && tasksOn && (await featureOn("pm_foundations", user).catch(() => false))) {
    const viewer = await workViewer(user);
    const access = await homeAccess(user);
    const [layout, note] = await Promise.all([homeLayoutFor(user, access), getHomeNote(user.id)]);
    const widgets: HomeWidgetSetup = {
      layout: layout.widgets,
      version: layout.version,
      addable: addableWidgets(layout.widgets, access).map((entry) => ({ kind: entry.kind, title: entry.title, description: entry.description })),
      note,
      given: layout.widgets.some((item) => item.kind === "assigned") ? (
        <Suspense fallback={<HomeSectionLoading />}>
          <TaskHome user={user} viewer={viewer} params={{ tab: query.tab, given: query.given, home: "tasks" }} basePath="/users" greet={false} part="given" />
        </Suspense>
      ) : null,
    };
    const board = (
      <MyWorkOverview
        user={user}
        viewer={viewer}
        query={query}
        widgets={widgets}
        greeting={<HomeGreeting name={user.name} />}
        switcher={null}
        others={
          <Suspense fallback={<HomeSectionLoading className="mt-6" />}>
            <TaskHome user={user} viewer={viewer} params={{ tab: query.tab, given: query.given, home: "tasks" }} basePath="/users" greet={false} part="others" />
          </Suspense>
        }
      />
    );
    return <ModulesHome name={displayName(user.name)} user={user} tasks={board} boardFirst />;
  }
  if (!hasModule(user, "APPROVAL")) {
    const tasks = tasksOn ? (
      <Suspense
        fallback={
          <p className="mt-10 text-label text-ink-muted" role="status">
            Loading your tasks…
          </p>
        }
      >
        <TaskHome user={user} viewer={await workViewer(user)} params={{ tab: query.tab, given: query.given, task: query.task }} basePath="/users" greet={false} />
      </Suspense>
    ) : null;
    return <ModulesHome name={displayName(user.name)} user={user} tasks={tasks} />;
  }
  // v1.72.1 (D-395, QA F-05): an old link to one task (/users?task=N) opens the
  // task itself; Task Management on Home doesn't show a single task.
  // v1.83.0 (D-410, owner): Home with ?task=N now shows that task in the side
  // pane (the shell's @pane slot) on the Home the person was on; it no longer
  // goes to the task's page or switches Home to Task Management.
  // A tab of the task lists opens Task Management.
  const asked = query.home === "tasks" || query.home === "approvals" ? query.home : query.tab || query.given ? "tasks" : null;
  // v1.51.1 (owner): Meetings is the third choice, for people with the Meeting module and its pages.
  const meetingsOn = hasModule(user, "MEETING") && !isHiddenHref("/users/meetings", (await navAccess(user)).hidden);
  const choices: HomeFocus[] = ["approvals", ...(tasksOn ? (["tasks"] as const) : []), ...(meetingsOn ? (["meetings"] as const) : [])];
  // D-307 (owner): a module not given yet stays on the switch, locked ("Coming soon").
  const lockedChoices: HomeFocus[] = [...(!hasModule(user, "TASK") ? (["tasks"] as const) : []), ...(!hasModule(user, "MEETING") ? (["meetings"] as const) : [])];
  // The tour points at the approval tiles, so it always opens on Approvals.
  const focus: HomeFocus =
    query.tour ? "approvals" : query.home === "meetings" && meetingsOn ? "meetings" : !tasksOn ? "approvals" : (asked ?? ((await isApproverForHome(user.id).catch(() => true)) ? "approvals" : "tasks"));
  const overview = query.view === "overview";
  // v1.63.0 (D-369, PM-A12): with "pm_foundations" on, Home greets with the
  // date and the time of day, and Task Management's sections are the person's
  // own widgets. The approval parts of Home are unchanged.
  const pmOn = await featureOn("pm_foundations", user).catch(() => false);

  if (focus === "meetings") {
    const base: Record<string, string> = { home: "meetings", ...(overview ? { view: "overview" } : {}) };
    const meetingHidden = (await navAccess(user)).hidden;
    // v1.77.1 (owner): the basic quick actions, as on the Task Management overview.
    const meetingQuick: QuickAction[] = [
      { href: "/users/meetings/new", label: "New meeting", icon: <CalendarPlus className="h-4 w-4" />, primary: true },
      { href: "/users/meetings", label: "All meetings", icon: <CalendarClock className="h-4 w-4" /> },
      { href: "/users/meetings?tab=approve", label: "To approve", icon: <ClipboardCheck className="h-4 w-4" /> },
      { href: "/users/meetings?tab=mine", label: "My meetings", icon: <FileEdit className="h-4 w-4" /> },
      { href: "/users/meetings/follow-ups", label: "Follow-ups", icon: <ListChecks className="h-4 w-4" /> },
      { href: "/users/calendar", label: "Calendar", icon: <CalendarDays className="h-4 w-4" /> },
    ].filter((item) => !isHiddenHref(item.href, meetingHidden));
    // v1.79.0 (D-406): the person's Meetings widgets (figures only with the dashboard page access).
    return (
      <MeetingHome
        user={user}
        query={query}
        base={base}
        figures={!isHiddenHref("/users/meetings/dashboard", meetingHidden)}
        switcher={<HomeFocusSwitch focus={focus} overview={overview} choices={choices} locked={lockedChoices} />}
        quick={meetingQuick}
        widgets={await overviewWidgets(user, "meetings")}
        greeting={pmOn ? <HomeGreeting name={user.name} /> : undefined}
      />
    );
  }

  if (focus === "tasks") {
    const viewer = await workViewer(user);
    let widgets: HomeWidgetSetup | undefined;
    if (pmOn) {
      const access = await homeAccess(user);
      const [layout, note] = await Promise.all([homeLayoutFor(user, access), getHomeNote(user.id)]);
      widgets = {
        layout: layout.widgets,
        version: layout.version,
        addable: addableWidgets(layout.widgets, access).map((entry) => ({ kind: entry.kind, title: entry.title, description: entry.description })),
        note,
        given: layout.widgets.some((item) => item.kind === "assigned") ? (
          <Suspense fallback={<HomeSectionLoading />}>
            <TaskHome user={user} viewer={viewer} params={{ tab: query.tab, given: query.given, home: "tasks" }} basePath="/users" greet={false} part="given" />
          </Suspense>
        ) : null,
      };
    }
    return (
      <MyWorkOverview
        user={user}
        viewer={viewer}
        query={query}
        widgets={widgets}
        greeting={pmOn ? <HomeGreeting name={user.name} /> : undefined}
        switcher={<HomeFocusSwitch focus={focus} overview={overview} choices={choices} locked={lockedChoices} />}
        others={
          <Suspense fallback={<HomeSectionLoading className="mt-6" />}>
            <TaskHome user={user} viewer={viewer} params={{ tab: query.tab, given: query.given, home: "tasks" }} basePath="/users" greet={false} part="others" />
          </Suspense>
        }
      />
    );
  }

  const approvalHidden = (await navAccess(user)).hidden;
  // v1.77.1 (owner): the basic quick actions, as on the Task Management overview. D-206: New request opens the page where people choose their own approvers.
  const approvalQuick: QuickAction[] = [
    { href: "/users/custom", label: "New request", icon: <FilePlus2 className="h-4 w-4" />, primary: true },
    { href: "/users/queue", label: "Waiting for me", icon: <Inbox className="h-4 w-4" /> },
    { href: "/users/requests", label: "My requests", icon: <FileText className="h-4 w-4" /> },
    { href: "/users/approved-by-me", label: "Approved by me", icon: <CheckCircle2 className="h-4 w-4" /> },
    { href: "/users/delegation", label: "Delegate", icon: <UserCheck className="h-4 w-4" /> },
    { href: "/users/reports", label: "Reports", icon: <BarChart3 className="h-4 w-4" /> },
    { href: "/users/search", label: "Search", icon: <Search className="h-4 w-4" /> },
  ].filter((item) => !isHiddenHref(item.href, approvalHidden));
  // v1.79.0 (D-406): the Approvals overview is built like My Work (features/home/ApprovalOverview.tsx).
  const [onboarded, approvalWidgets] = await Promise.all([hasFlag(user.id, "ONBOARDING_DONE"), overviewWidgets(user, "approvals")]);
  return (
    <ApprovalOverview
      user={user}
      query={query}
      overview={overview}
      switcher={choices.length + lockedChoices.length > 1 ? <HomeFocusSwitch focus={focus} overview={overview} choices={choices} locked={lockedChoices} /> : null}
      quick={approvalQuick}
      widgets={approvalWidgets}
      greeting={pmOn ? <HomeGreeting name={user.name} /> : undefined}
      checklist={!onboarded ? <FirstUseChecklist hidden={approvalHidden.has("users.queue") ? ["/users/queue", "/users/delegation"] : []} /> : null}
    />
  );
}

// D-264: the Approvals / Task Management choice at the top of Home.
// overview: keeps ?view=overview (the Classic view's Overview, not its Gateway).
function HomeFocusSwitch({ focus, overview, choices, locked = [] }: { focus: HomeFocus; overview: boolean; choices: readonly HomeFocus[]; locked?: readonly HomeFocus[] }) {
  const LABEL: Record<HomeFocus, string> = { approvals: "Approvals", tasks: "Task Management", meetings: "Meetings" };
  const options: [HomeFocus, string][] = choices.map((key) => [key, LABEL[key]]);
  const soon = locked.filter((key) => !choices.includes(key));
  return (
    <nav aria-label="Show on Home" className="inline-flex rounded-lg border border-line bg-surface-muted p-0.5" data-testid="home-focus">
      {options.map(([key, label]) => (
        <Link
          key={key}
          href={`/users?${overview ? "view=overview&" : ""}home=${key}`}
          aria-current={focus === key ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-label font-medium ${focus === key ? "bg-raised text-primary-700 shadow-card" : "text-ink-muted hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
      {soon.map((key) => (
        <ComingSoonChip key={key} label={LABEL[key]} />
      ))}
    </nav>
  );
}

// D-168: Home for someone without the Approval module.
function ModulesHome({ name, user, tasks, boardFirst = false }: { name: string; user: Parameters<typeof hasModule>[0]; tasks: React.ReactNode; boardFirst?: boolean }) {
  const links = [
    hasModule(user, "TASK") && { href: "/users/tasks", label: "My tasks", body: "Tasks given to you, and tasks you give others." },
    hasModule(user, "MEETING") && { href: "/users/meetings", label: "Meetings", body: "Your meetings, approvals and action items." },
    hasModule(user, "TICKET") && { href: "/users/tickets", label: "My tickets", body: "Raise a ticket and follow the ones you raised or were given." },
    hasModule(user, "INFORMATION") && { href: "/users/information", label: "Information inbox", body: "Notices and circulars for you." },
    hasModule(user, "AI") && { href: "/users/ai/assistant", label: "AI Assistant", body: "Ask your business analyst." },
    { href: "/users/calendar", label: "Calendar", body: "Your dates and personal entries." },
  ].filter(Boolean) as { href: string; label: string; body: string }[];
  // D-307 (owner): the modules not given yet, blurred and locked ("Coming soon").
  const soon = (["TASK", "PROJECT", "MEETING", "TICKET", "INFORMATION", "AI"] as const).filter((module) => !hasModule(user, module));
  return (
    <>
      {/* v1.65.0 (PM-A14): the widget board (with its own greeting) comes first; the module links follow. */}
      {boardFirst ? tasks : <PageHeader title={`Welcome, ${name}`} />}
      {boardFirst && <h2 className="mb-2 mt-8 font-semibold">Your other modules</h2>}
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="modules-home">
        {links.map((link) => (
          <li key={link.href}>
            {/* D-179: what each link opens is its hover text. */}
            <Link href={link.href} title={link.body} className="card-link block px-5 py-4">
              <span className="block font-semibold">{link.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {soon.length > 0 && (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="modules-coming-soon">
          {soon.map((module) => (
            <li key={module}>
              <ComingSoonCard title={MODULE_LABEL[module]} lines={2} />
            </li>
          ))}
        </ul>
      )}
      {!boardFirst && tasks}
    </>
  );
}

// v1.43.0: the greeting by the hour in India.
function greetingFor(now: Date): string {
  const hour = indiaHour(now);
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

// v1.72.2 (D-394, QA visual G7): Home's task sections load with the list
// skeleton like every other module (not a line of text).
function HomeSectionLoading({ className = "" }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading your tasks" className={className}>
      <ListSkeleton rows={3} />
    </div>
  );
}
