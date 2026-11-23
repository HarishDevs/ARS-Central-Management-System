import { headers } from "next/headers";
import { PATH_HEADER } from "@/lib/security/path-signature";
import { getCurrentSession } from "@/server/auth/session";
import { evaluateAreaAccess } from "@/server/authorization/policy";
import { checkPageKey } from "@/server/authorization/page-access";
import { featureOn } from "@/server/settings/features";
import { hasModule } from "@/server/modules/modules";
import { getUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { clampPaneWidth, PANE_MODE_SETTING, PANE_SETTING, parsePaneMode } from "@/server/work/pm-rules";
import { paneCloseHref, paneTaskId, TaskPane } from "@/features/work/TaskPane";

export const dynamic = "force-dynamic";

// v1.83.0 (D-410, owner: every task opens in the side pane). The signed-in
// shell's @pane slot: on any /users screen, ?task=<id> draws that task beside
// the screen (or in the centred dialog, the person's choice). The screen
// itself (children) is left alone, so it stays in place and usable. Every
// rule stays on the server: the users area (the layout), Tasks switched on
// and the Tasks module, the task page not hidden for the person, and the
// task's own visibility (TaskDetail: "not found" for anyone who can't see it).
export default async function PaneSlot({ params, searchParams }: { params: Promise<{ rest?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const taskId = paneTaskId(query.task);
  if (!taskId) return null;
  const session = await getCurrentSession();
  const user = session?.user;
  if (!user || !evaluateAreaAccess(user, "users").allowed) return null;
  if (!hasModule(user, "TASK") || !(await featureOn("tasks", user).catch(() => false))) return null;
  // The screen's own address, as the middleware saw it (a catch-all slot's
  // params hold the whole path, "users" included, so they aren't used first).
  const asked = (await headers()).get(PATH_HEADER);
  const { rest } = await params;
  const parts = (rest ?? []).filter((part, index) => !(index === 0 && part === "users"));
  const path = asked && /^\/users(\/|$)/.test(asked) ? asked : `/users${parts.length ? `/${parts.map(encodeURIComponent).join("/")}` : ""}`;
  const closeHref = paneCloseHref(path, query);
  const [width, mode, page] = await Promise.all([
    getUserSetting(user.id, PANE_SETTING).catch(() => null),
    getUserSetting(user.id, PANE_MODE_SETTING).catch(() => null),
    checkPageKey(user, "users.task", false),
  ]);
  return <TaskPane key={taskId} taskId={page.ok ? taskId : 0} user={user} closeHref={closeHref} mode={parsePaneMode(mode)} width={clampPaneWidth(width)} />;
}
