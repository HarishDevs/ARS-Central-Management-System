import { requireArea } from "@/server/authorization/guards";
import { AppShell } from "@/features/shell/AppShell";
import { usersNav } from "@/features/shell/users-nav";
import { HolidayPrompt } from "@/features/work/client";
import { TaskCreator } from "@/features/work/TaskCreator";
import { TaskPaneHost } from "@/features/work/TaskPaneHost";
import { isMobileLayout } from "@/server/ui/layout-mode";
import { featureOn } from "@/server/settings/features";
import { hasModule } from "@/server/modules/modules";
import { listVisibleProjects } from "@/lib/db/repositories/work.repository";
import { peopleOptions } from "@/server/work/page-context";
import { workViewer } from "@/server/work/task-access";
import { chatAccess } from "@/server/ai/policy";
import { PushKeeper } from "@/features/pwa/PushKeeper";
import { ProjectsAccess } from "@/features/work/projects-access";
import { CelebrationProvider } from "@/features/work/celebrate";
import { getUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { loadSetting } from "@/server/work/holiday-store";
import { CELEBRATION_SETTING, clampPaneWidth, PANE_MODE_SETTING, PANE_SETTING, parseCelebration, parsePaneMode, parsePmExtras, PM_EXTRAS_KEY } from "@/server/work/pm-rules";
import { headers } from "next/headers";
import { NEXT_HEADER } from "@/lib/security/path-signature";
import { PaneReserve } from "@/features/work/PaneReserve";

export const dynamic = "force-dynamic";

// v1.83.0 (D-410, owner): `pane` is the @pane slot: ?task=<id> on any screen
// draws that task beside it (TaskPaneHost turns task links into ?task=).
export default async function UsersLayout({ children, pane }: { children: React.ReactNode; pane: React.ReactNode }) {
  const { user } = await requireArea("users");
  // D-221: "Create → Task" works on every page (the Draft task panel).
  // D-307 (owner): Projects is its own module.
  const projectsOn = hasModule(user, "PROJECT");
  const creator =
    hasModule(user, "TASK") && (await featureOn("tasks", user))
      ? await Promise.all([projectsOn ? listVisibleProjects(await workViewer(user)) : Promise.resolve([]), peopleOptions()])
          .then(([projects, people]) => ({ projects: projects.slice(0, 200).map((project) => ({ id: project.id, name: project.name, color: project.color })), people }))
          .catch(() => null)
      : null;
  // D-238: the Draft task's sparkle shows only for people Pico Bot answers.
  const ai =
    creator && (await featureOn("ai", user))
      ? await chatAccess(user)
          .then((access) => !access.policy.emergencyStop && access.modes.length > 0)
          .catch(() => false)
      : false;
  // v1.62.0 (D-368): the completion animation and celebrations ("pm_foundations"):
  // the person's choice, else the default IT set in Task settings (Occasional).
  const pmOn = await featureOn("pm_foundations", user);
  const celebration = pmOn
    ? (parseCelebration(await getUserSetting(user.id, CELEBRATION_SETTING).catch(() => null)) ?? parsePmExtras(await loadSetting(PM_EXTRAS_KEY).catch(() => null)).celebrations)
    : "OFF";
  // v1.89.0 (D-424, PERF-02): a page loaded with ?task= on a computer reserves the side
  // pane's room before the screen is drawn (PaneReserve); the pane itself follows.
  const asked = (await headers()).get(NEXT_HEADER) ?? "";
  const paneAsked = creator !== null && /[?&]task=\d{1,10}(&|$)/.test(asked) && !(await isMobileLayout());
  const reserve = paneAsked
    ? await Promise.all([getUserSetting(user.id, PANE_MODE_SETTING).catch(() => null), getUserSetting(user.id, PANE_SETTING).catch(() => null)]).then(([mode, width]) => (parsePaneMode(mode) === "SIDE" ? clampPaneWidth(width) : null))
    : null;
  return (
    <AppShell area="users" user={user} nav={await usersNav(user)}>
      {reserve !== null && <PaneReserve width={reserve} />}
      <CelebrationProvider enabled={pmOn} choice={celebration}>
      <ProjectsAccess on={projectsOn}>
        {children}
        {pane}
        {/* Phones (the mobile layout) keep the task's own full-screen page. */}
        {creator && !(await isMobileLayout()) && <TaskPaneHost />}
        <HolidayPrompt />
        <PushKeeper userId={user.id} />
        {creator && <TaskCreator projects={creator.projects} people={creator.people} meId={user.id} ai={ai} />}
      </ProjectsAccess>
      </CelebrationProvider>
    </AppShell>
  );
}
