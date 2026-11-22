import "server-only";
import type { ModuleCode } from "@/server/modules/modules";
import { hasModule } from "@/server/modules/modules";
import { featureOn } from "@/server/settings/features";
import { isHiddenHref, navAccess } from "@/server/authorization/page-access";
import * as repo from "@/lib/db/repositories/home.repository";
import { addableWidgets, cleanNote, isOverviewScope, readLayout, validLayout, type HomeAccess, type OverviewScope, type WidgetItem, type WidgetKind } from "@/server/home/widgets";

// v1.63.0 (D-369, PM-A12): Home widgets and the private notepad, behind the
// "pm_foundations" switch. Deny by default: only the signed-in person's own
// layout and note, and only widgets of modules they have (checked here, not
// only by hiding a button).
// v1.79.0 (D-406): one layout per overview (approvals, tasks, meetings).
export interface HomePerson {
  id: number;
  roles: readonly string[];
  modules: readonly ModuleCode[];
}
export type HomeResult<T> = { ok: true; value: T; message: string } | { ok: false; message: string; conflict?: boolean };

export async function homeAccess(person: HomePerson): Promise<HomeAccess> {
  const hidden = (await navAccess(person)).hidden;
  const tasks = hasModule(person, "TASK") && (await featureOn("tasks", person).catch(() => false)) && !isHiddenHref("/users/work", hidden);
  const meetings = hasModule(person, "MEETING") && !isHiddenHref("/users/meetings", hidden);
  return {
    tasks,
    projects: tasks && hasModule(person, "PROJECT"),
    forms: tasks && (await featureOn("pm_forms", person).catch(() => false)),
    approvals: hasModule(person, "APPROVAL"),
    meetings,
    meetingFigures: meetings && !isHiddenHref("/users/meetings/dashboard", hidden),
  };
}

// Whether the person may open an overview at all (its module and pages).
export function scopeOpen(access: HomeAccess, scope: OverviewScope): boolean {
  return scope === "tasks" ? true : scope === "approvals" ? Boolean(access.approvals) : Boolean(access.meetings);
}

export async function homeLayoutFor(person: HomePerson, access?: HomeAccess, scope: OverviewScope = "tasks"): Promise<{ widgets: WidgetItem[]; version: number }> {
  const stored = await repo.getHomeLayout(person.id, scope);
  return { widgets: readLayout(stored?.widgets ?? null, access ?? (await homeAccess(person)), scope), version: stored?.version ?? 0 };
}

// What an overview page needs to draw the person's widgets: the layout, the
// Add widgets list and the shared note.
export interface OverviewWidgets {
  scope: OverviewScope;
  layout: WidgetItem[];
  version: number;
  addable: { kind: WidgetKind; title: string; description: string }[];
  note: { body: string; version: number };
  editable: boolean; // the "pm_foundations" switch: without it the default layout, no Customise
}
export async function overviewWidgets(person: HomePerson, scope: OverviewScope, access?: HomeAccess): Promise<OverviewWidgets> {
  const allowed = access ?? (await homeAccess(person));
  const editable = await featureOn("pm_foundations", person).catch(() => false);
  const [layout, note] = await Promise.all([editable ? homeLayoutFor(person, allowed, scope) : Promise.resolve({ widgets: readLayout(null, allowed, scope), version: 0 }), editable ? repo.getHomeNote(person.id) : Promise.resolve({ body: "", version: 0 })]);
  return {
    scope,
    layout: layout.widgets,
    version: layout.version,
    addable: editable ? addableWidgets(layout.widgets, allowed, scope).map((entry) => ({ kind: entry.kind, title: entry.title, description: entry.description })) : [],
    note,
    editable,
  };
}

export async function saveLayout(person: HomePerson, input: { widgets: unknown; version: unknown; scope?: unknown } | { reset: true; scope?: unknown }): Promise<HomeResult<{ version: number }>> {
  if (!(await featureOn("pm_foundations", person))) return { ok: false, message: "Home widgets aren't switched on yet." };
  const scope: OverviewScope | null = input.scope === undefined ? "tasks" : isOverviewScope(input.scope) ? input.scope : null;
  if (!scope) return { ok: false, message: "That change isn't valid." };
  const access = await homeAccess(person);
  if (!scopeOpen(access, scope)) return { ok: false, message: "That overview isn't open to you." };
  if ("reset" in input) {
    await repo.resetHomeLayout(person.id, scope);
    return { ok: true, value: { version: 0 }, message: "Home is back to the default widgets." };
  }
  const version = typeof input.version === "number" && Number.isInteger(input.version) && input.version >= 0 ? input.version : null;
  if (version === null) return { ok: false, message: "That change isn't valid." };
  const widgets = validLayout(input.widgets, access, scope);
  if (!widgets) return { ok: false, message: "That layout isn't valid." };
  const saved = await repo.saveHomeLayout(person.id, widgets, version, scope);
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
