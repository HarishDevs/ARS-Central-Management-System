import "server-only";
import type { ModuleCode } from "@/server/modules/modules";
import { hasModule } from "@/server/modules/modules";
import { featureOn } from "@/server/settings/features";
import { isHiddenHref, navAccess } from "@/server/authorization/page-access";
import * as repo from "@/lib/db/repositories/home.repository";
import { cleanNote, readLayout, validLayout, type HomeAccess, type WidgetItem } from "@/server/home/widgets";

// v1.63.0 (D-369, PM-A12): Home widgets and the private notepad, behind the
// "pm_foundations" switch. Deny by default: only the signed-in person's own
// layout and note, and only widgets of modules they have (checked here, not
// only by hiding a button).
export interface HomePerson {
  id: number;
  roles: readonly string[];
  modules: readonly ModuleCode[];
}
export type HomeResult<T> = { ok: true; value: T; message: string } | { ok: false; message: string; conflict?: boolean };

export async function homeAccess(person: HomePerson): Promise<HomeAccess> {
  const tasks = hasModule(person, "TASK") && (await featureOn("tasks", person).catch(() => false)) && !isHiddenHref("/users/work", (await navAccess(person)).hidden);
  return { tasks, projects: tasks && hasModule(person, "PROJECT") };
}

export async function homeLayoutFor(person: HomePerson, access?: HomeAccess): Promise<{ widgets: WidgetItem[]; version: number }> {
  const stored = await repo.getHomeLayout(person.id);
  return { widgets: readLayout(stored?.widgets ?? null, access ?? (await homeAccess(person))), version: stored?.version ?? 0 };
}

export async function saveLayout(person: HomePerson, input: { widgets: unknown; version: unknown } | { reset: true }): Promise<HomeResult<{ version: number }>> {
  if (!(await featureOn("pm_foundations", person))) return { ok: false, message: "Home widgets aren't switched on yet." };
  if ("reset" in input) {
    await repo.resetHomeLayout(person.id);
    return { ok: true, value: { version: 0 }, message: "Home is back to the default widgets." };
  }
  const version = typeof input.version === "number" && Number.isInteger(input.version) && input.version >= 0 ? input.version : null;
  if (version === null) return { ok: false, message: "That change isn't valid." };
  const widgets = validLayout(input.widgets, await homeAccess(person));
  if (!widgets) return { ok: false, message: "That layout isn't valid." };
  const saved = await repo.saveHomeLayout(person.id, widgets, version);
  if (saved === "CONFLICT") return { ok: false, conflict: true, message: "Your Home was changed in another window. It has been reloaded; please try again." };
  return { ok: true, value: { version: saved }, message: "Home saved." };
}

export async function saveNote(person: HomePerson, body: unknown, version: unknown): Promise<HomeResult<{ version: number }>> {
  if (!(await featureOn("pm_foundations", person))) return { ok: false, message: "Home widgets aren't switched on yet." };
  const text = cleanNote(body);
  if (text === null) return { ok: false, message: "Your note is too long (50,000 characters at most)." };
  const at = typeof version === "number" && Number.isInteger(version) && version >= 0 ? version : null;
  if (at === null) return { ok: false, message: "That change isn't valid." };
  const saved = await repo.saveHomeNote(person.id, text, at);
  if (saved === "CONFLICT") return { ok: false, conflict: true, message: "Your note was changed in another window. Reload the page to see the latest, then try again." };
  return { ok: true, value: { version: saved }, message: "Note saved." };
}
