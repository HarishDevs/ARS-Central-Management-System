import { requireFeature } from "@/server/settings/feature-guard";
import { personLabel } from "@/lib/people/label";
import "server-only";
import { notFound, redirect } from "next/navigation";
import { switchedOffHref } from "@/features/shell/switched-off";
import { requireArea } from "@/server/authorization/guards";
import { listActiveUserOptions } from "@/lib/db/repositories/admin-users.repository";
import { workViewer } from "@/server/work/task-access";

// D-215: what every Task & Project Management page starts with: the signed-in
// person (access to the page is checked by requireArea), the Tasks switch,
// and the person as a project viewer.
export async function workPage() {
  const { user } = await requireArea("users");
  // v1.72.1 (D-395): a switched-off feature says so (not a 404).
  await requireFeature("tasks", user);
  const viewer = await workViewer(user);
  return { user, viewer };
}

export async function peopleOptions(): Promise<{ id: number; label: string; detail?: string }[]> {
  // v1.52.1 (owner): "Name - Employee code", the department below.
  return (await listActiveUserOptions()).map((person) => ({ id: person.id, label: personLabel(person), detail: person.departmentName ?? undefined }));
}

// v1.69.0 (D-382): portfolio pages: the Projects module (page access refuses
// the path without it) and the "pm_portfolios" switch; otherwise not found.
export async function portfolioPage() {
  const context = await workPage();
  const { portfoliosOn } = await import("@/server/work/portfolios");
  if (context.viewer.projects === false) notFound();
  // v1.72.1 (D-395): the switch off → the "switched off" screen.
  if (!(await portfoliosOn(context.user))) redirect(switchedOffHref("pm_portfolios"));
  return context;
}
