import "server-only";
import { departmentName, saveProjectOrder, sidebarProjects } from "@/lib/db/repositories/pm.repository";
import { listVisiblePortfolios } from "@/lib/db/repositories/portfolios.repository";
import { getUserSetting, setUserSetting } from "@/lib/db/repositories/user-settings.repository";
import { workViewer } from "@/server/work/task-access";
import { moveInOrder, parseSidebarSort, sidebarSortSetting, sortSidebar, type SidebarList, type SidebarProject, type SidebarSort } from "@/server/work/pm-rules";
import type { ModuleCode } from "@/server/modules/modules";

// v1.62.0 (D-368, spec NAV sidebar): the person's Starred projects and the
// projects shared with their department, each with its own sort (Manual,
// A–Z, Recently opened). Only projects the person can see are listed or moved.
type Who = { id: number; roles: readonly string[]; modules?: readonly ModuleCode[] };
export interface SidebarSectionData {
  list: SidebarList;
  sort: SidebarSort;
  items: Pick<SidebarProject, "id" | "name" | "color">[];
}

async function section(user: Who, list: SidebarList): Promise<SidebarSectionData> {
  const viewer = await workViewer(user);
  const [items, sortValue] = await Promise.all([sidebarProjects(viewer, list), getUserSetting(user.id, sidebarSortSetting(list))]);
  const sort = parseSidebarSort(sortValue, list);
  return { list, sort, items: sortSidebar(items, sort).map(({ id, name, color }) => ({ id, name, color })) };
}

// v1.69.0 (D-382): with portfolios on, the starred portfolios too (under Starred, by name).
export async function loadSidebar(user: Who, portfolios = false): Promise<{ starred: SidebarSectionData; departments: SidebarSectionData & { departmentName: string | null }; portfolios: { id: number; name: string; color: string }[] | null }> {
  const viewer = await workViewer(user);
  const [starred, departments, name, starredPortfolios] = await Promise.all([
    section(user, "STARRED"),
    section(user, "DEPARTMENTS"),
    departmentName(viewer.departmentId),
    portfolios ? listVisiblePortfolios(viewer, { starredOnly: true, limit: 50 }) : Promise.resolve(null),
  ]);
  return { starred, departments: { ...departments, departmentName: name }, portfolios: starredPortfolios ? starredPortfolios.map(({ id, name: label, color }) => ({ id, name: label, color })).sort((a, b) => a.name.localeCompare(b.name)) : null };
}

// Moves one project up or down in the person's manual order of that list
// (the list switches to Manual). Not in the list (or not visible): not found.
export async function moveSidebarProject(user: Who, list: SidebarList, projectId: number, direction: "up" | "down"): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const viewer = await workViewer(user);
  const items = await sidebarProjects(viewer, list);
  // Moving from A–Z or Recent starts the manual order from what the person sees.
  const current = sortSidebar(items, parseSidebarSort(await getUserSetting(user.id, sidebarSortSetting(list)), list)).map((item) => item.id);
  if (!current.includes(projectId)) return { ok: false, message: "Not found." };
  const next = moveInOrder(current, projectId, direction);
  if (!next) return { ok: false, message: direction === "up" ? "It's already first." : "It's already last." };
  await saveProjectOrder(user.id, list, next);
  await setUserSetting(user.id, sidebarSortSetting(list), "MANUAL");
  const name = items.find((item) => item.id === projectId)?.name ?? "Project";
  return { ok: true, message: `${name} moved to position ${next.indexOf(projectId) + 1} of ${next.length}.` };
}

export async function setSidebarSort(user: Who, list: SidebarList, sort: SidebarSort): Promise<void> {
  await setUserSetting(user.id, sidebarSortSetting(list), sort);
}
