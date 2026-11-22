import { featureOn } from "@/server/settings/features";
import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { withTransaction } from "@/lib/db/transaction";
import { recordAudit } from "@/lib/db/repositories/audit.repository";
import * as repo from "@/lib/db/repositories/work.repository";
import type { TaskActor } from "@/server/modules/tasks";
import { projectAbilities, type WorkViewer } from "@/server/work/access";
import { BOARD_SECTIONS, isTabRange, tabSettings } from "@/server/work/my-sections";
import { DEFAULT_SUMMARY_BOARD, DEFAULT_SUMMARY_CALENDAR, parseSummaryFields, FIELDS_SETTING, summaryListStart, validSummaryView } from "@/server/work/summary-views";
import { getUserSetting } from "@/lib/db/repositories/user-settings.repository";
import {
  buildStrip,
  canRemoveTab,
  cleanTabName,
  copyName,
  DEFAULT_BOARD,
  DEFAULT_PROJECT_LIST,
  allowedView,
  baseOrder,
  materialisePlan,
  maxTabs,
  sameTabs,
  TAB_VIEW_LABEL,
  uniqueName,
  validTabConfig,
  type StripTab,
  type TabView,
} from "@/server/work/view-tabs";

// v1.61.0 (D-367, PM phase A): a project's tab strip. Owners and editors add,
// rename, reorder, set the default, duplicate, remove and save tabs; everyone
// who sees the project uses them. Deny by default: anyone else gets "not found"
// (no hint that the project exists). The first change writes the built-in
// views as rows (materialise), so every tab behaves the same afterwards.
// v1.63.0 (D-369, PM-A13): the same rules for a person's My Tasks strip
// (owner = that person; nobody else can see or change it).
export type TabResult<T = undefined> = { ok: true; value: T; message: string } | { ok: false; message: string };
const NOT_FOUND = { ok: false as const, message: "Not found." };
const ONLY_EDITORS = { ok: false as const, message: "Only the project's owners and editors can change its tabs." };

const starterConfig = (type: TabView): object => (type === "LIST" ? DEFAULT_PROJECT_LIST : type === "BOARD" ? DEFAULT_BOARD : {});
// v1.77.0 (D-404): a Task Summary tab starts with the person's Customise › Fields
// columns (List) and the Task Summary Board / Calendar settings.
async function starterFor(owner: Owner, db: PoolConnection): Promise<(type: TabView) => object> {
  if (owner.scope === "PROJECT") return starterConfig;
  const list = summaryListStart(parseSummaryFields(await getUserSetting(owner.id, FIELDS_SETTING, db)));
  return (type) => (type === "LIST" ? list : type === "BOARD" ? DEFAULT_SUMMARY_BOARD : type === "CALENDAR" ? DEFAULT_SUMMARY_CALENDAR : {});
}

type Owner = repo.TabOwner;
const labelFor = (owner: Owner) => (owner.scope === "PROJECT" ? "A project" : "My Tasks");

async function mayEdit(projectId: number, viewer: WorkViewer, db: PoolConnection): Promise<"OK" | "NOT_FOUND" | "READ_ONLY"> {
  const found = await repo.projectFor(projectId, viewer, db);
  if (!found || found.project.isTemplate) return "NOT_FOUND";
  return projectAbilities(found.role).edit ? "OK" : "READ_ONLY";
}

// Writes the built-in views as rows (once) and returns the stored strip with
// a map from the keys the page knew ("vLIST", "t12") to row ids.
export async function materialise(target: number | Owner, by: number, db: PoolConnection): Promise<{ strip: (StripTab & { id: number })[]; ids: Map<string, number> }> {
  const owner: Owner = typeof target === "number" ? { scope: "PROJECT", id: target } : target;
  await repo.lockTabOwner(owner, db);
  const data = await repo.listTabs(owner, db);
  const strip = buildStrip(data.rows, data.tabsSet, data.defaultView, baseOrder(owner.scope));
  const ids = new Map<string, number>();
  if (data.tabsSet) {
    for (const tab of strip) ids.set(tab.key, tab.id!);
    return { strip: strip as (StripTab & { id: number })[], ids };
  }
  const plan = materialisePlan(strip);
  const start = await starterFor(owner, db);
  const ordered: number[] = [];
  for (const [index, item] of plan.entries()) {
    let id = item.id;
    if (id === null) {
      const inserted = await repo.insertTab(owner, { type: item.type, name: item.name, config: start(item.type), position: (index + 1) * 1024 }, by, db);
      if (inserted === "DUPLICATE") throw new Error("tab name clash while writing the strip");
      id = inserted;
    }
    ids.set(item.key, id);
    ordered.push(id);
  }
  await repo.setOwnerTabPositions(owner, ordered, db);
  const defaultKey = strip.find((tab) => tab.isDefault)?.key;
  if (defaultKey) await repo.setOwnerDefaultTab(owner, ids.get(defaultKey)!, db);
  await repo.markTabsSet(owner, db);
  const stored = strip.map((tab, index) => ({ ...tab, id: ordered[index]!, key: `t${ordered[index]}`, name: plan[index]!.name }));
  // The page's old keys and the new ones both resolve.
  for (const tab of stored) ids.set(tab.key, tab.id);
  return { strip: stored, ids };
}

type Op =
  | { op: "add"; type: string; name?: string }
  | { op: "rename"; key: string; name: string }
  | { op: "default"; key: string }
  | { op: "duplicate"; key: string }
  | { op: "remove"; key: string }
  | { op: "reorder"; keys: string[] }
  | { op: "save"; key: string; config: unknown; auto?: boolean }
  // v1.76.0 (D-401): a Task Summary tab's range and (Board) sections.
  | { op: "settings"; key: string; range?: string; sections?: string };

export async function changeTabs(projectId: number, input: Op, actor: TaskActor, viewer: WorkViewer): Promise<TabResult<{ id: number | null }>> {
  return withTransaction(async (db) => {
    const access = await mayEdit(projectId, viewer, db);
    if (access === "NOT_FOUND") return NOT_FOUND;
    if (access === "READ_ONLY") return ONLY_EDITORS;
    return applyTabChange({ scope: "PROJECT", id: projectId }, input, actor, db);
  });
}

// v1.63.0 (D-369): the person's own My Tasks tabs. The owner is always the
// person signed in, so a tab of anyone else's strip is "not found".
export async function changeMyTabs(input: Op, actor: TaskActor): Promise<TabResult<{ id: number | null }>> {
  return withTransaction((db) => applyTabChange({ scope: "MY_TASKS", id: actor.id }, input, actor, db));
}

async function applyTabChange(owner: Owner, input: Op, actor: TaskActor, db: PoolConnection): Promise<TabResult<{ id: number | null }>> {
  {
    const MAX = maxTabs(owner.scope);
    // v1.76.0 (D-401, owner; spec BR-MYT-021): personal tab names may repeat;
    // a project's tabs keep unique names (shared by everyone).
    const personal = owner.scope === "MY_TASKS";
    const nameFor = (name: string, taken: string[]) => (personal ? name : uniqueName(name, taken));
    // Checks that need no writing come first.
    if (input.op === "add" && !allowedView(owner.scope, input.type, await featureOn("pm_planning", actor).catch(() => false), await featureOn("pm_reporting", actor).catch(() => false), await featureOn("pm_extras", actor).catch(() => false))) return { ok: false, message: "That view isn't available yet." };
    if (input.op === "rename" && !cleanTabName(input.name)) return { ok: false, message: "Give the tab a name (up to 60 characters)." };
    if (input.op === "reorder" && (!Array.isArray(input.keys) || input.keys.length > MAX + 5 || !input.keys.every((key) => typeof key === "string" && /^(t\d{1,10}|v[A-Z]{4,8})$/.test(key)))) return { ok: false, message: "That order isn't valid." };
    const { strip, ids } = await materialise(owner, actor.id, db);
    const tabOf = (key: string) => {
      const id = ids.get(key);
      return id === undefined ? null : (strip.find((tab) => tab.id === id) ?? null);
    };
    const audit = (op: string, metadata: Record<string, unknown> = {}) =>
      recordAudit({ actorUserId: actor.id, action: owner.scope === "PROJECT" ? "PROJECT_TABS_CHANGED" : "MY_TASKS_TABS_CHANGED", entityType: owner.scope === "PROJECT" ? "PROJECT" : "USER", entityId: owner.id, sessionId: actor.sessionId, ipAddress: actor.ipAddress ?? null, metadata: { op, ...metadata } }, db);
    switch (input.op) {
      case "add": {
        if (strip.length >= MAX) return { ok: false, message: `At most ${MAX} tabs.` };
        const type = input.type as TabView;
        const asked = input.name === undefined || input.name === "" ? TAB_VIEW_LABEL[type] : cleanTabName(input.name);
        if (!asked) return { ok: false, message: "Give the tab a name (up to 60 characters)." };
        const name = nameFor(asked, strip.map((tab) => tab.name));
        const id = await repo.insertTab(owner, { type, name, config: (await starterFor(owner, db))(type), position: (strip.length + 1) * 1024 }, actor.id, db);
        if (id === "DUPLICATE") return { ok: false, message: "There is a tab with that name." };
        await audit("add", { tab: id, type });
        return { ok: true, value: { id }, message: `Tab "${name}" added.` };
      }
      case "rename": {
        const tab = tabOf(input.key);
        if (!tab) return NOT_FOUND;
        const name = cleanTabName(input.name)!;
        if (name === tab.name) return { ok: true, value: { id: tab.id }, message: "Saved." };
        if ((await repo.renameWorkView(tab.id, name, db)) === "DUPLICATE") return { ok: false, message: "There is a tab with that name." };
        await audit("rename", { tab: tab.id });
        return { ok: true, value: { id: tab.id }, message: "Tab renamed." };
      }
      case "default": {
        const tab = tabOf(input.key);
        if (!tab) return NOT_FOUND;
        await repo.setOwnerDefaultTab(owner, tab.id, db);
        await audit("default", { tab: tab.id });
        return { ok: true, value: { id: tab.id }, message: `"${tab.name}" opens first now.` };
      }
      case "duplicate": {
        const tab = tabOf(input.key);
        if (!tab) return NOT_FOUND;
        if (strip.length >= MAX) return { ok: false, message: `At most ${MAX} tabs.` };
        const source = await repo.findTab(owner, tab.id, db);
        const name = personal ? `${tab.name.slice(0, 53)} (copy)` : copyName(tab.name, strip.map((item) => item.name));
        const id = await repo.insertTab(owner, { type: tab.type, name, config: source?.config ?? starterConfig(tab.type), position: 0 }, actor.id, db);
        if (id === "DUPLICATE") return { ok: false, message: "There is a tab with that name." };
        const order = strip.flatMap((item) => (item.id === tab.id ? [item.id, id] : [item.id]));
        await repo.setOwnerTabPositions(owner, order, db);
        await audit("duplicate", { tab: tab.id, copy: id });
        return { ok: true, value: { id }, message: `Tab "${name}" added.` };
      }
      case "remove": {
        const tab = tabOf(input.key);
        if (!tab) return NOT_FOUND;
        if (!canRemoveTab(strip)) return { ok: false, message: `${labelFor(owner)} keeps at least one tab.` };
        await repo.deleteWorkView(tab.id, db);
        if (tab.isDefault) {
          const next = strip.find((item) => item.id !== tab.id)!;
          await repo.setOwnerDefaultTab(owner, next.id, db);
        }
        await audit("remove", { tab: tab.id, type: tab.type });
        return { ok: true, value: { id: null }, message: `Tab "${tab.name}" removed.` };
      }
      case "reorder": {
        const mapped = input.keys.map((key) => ids.get(key));
        if (mapped.some((id) => id === undefined)) return { ok: false, message: "The tabs changed meanwhile. Please try again." };
        const order = mapped as number[];
        if (!sameTabs(strip.map((tab) => `t${tab.id}`), order.map((id) => `t${id}`))) return { ok: false, message: "The tabs changed meanwhile. Please try again." };
        await repo.setOwnerTabPositions(owner, order, db);
        await audit("reorder");
        return { ok: true, value: { id: null }, message: "Tabs reordered." };
      }
      case "save": {
        const tab = tabOf(input.key);
        if (!tab) return NOT_FOUND;
        // v1.77.0 (D-404): a Task Summary Board or Calendar tab keeps its own settings.
        const config = personal && (tab.type === "BOARD" || tab.type === "CALENDAR") ? validSummaryView(tab.type, input.config) : validTabConfig(tab.type, input.config);
        if (config === null) return { ok: false, message: "That view can't be saved. Reset it and try again." };
        // v1.76.0 (D-401): a Task Summary tab keeps its range and sections (set apart, op "settings").
        const stored = personal ? tabSettings((await repo.findTab(owner, tab.id, db))?.config) : null;
        await repo.updateWorkView(tab.id, { config: stored ? { ...config, ...stored } : config }, db);
        // Auto-saves of a personal tab aren't audited one by one (they come a second after each change).
        if (!input.auto || !personal) await audit("save", { tab: tab.id });
        return { ok: true, value: { id: tab.id }, message: "View saved." };
      }
      case "settings": {
        if (!personal) return NOT_FOUND;
        const tab = tabOf(input.key);
        if (!tab) return NOT_FOUND;
        if (input.range !== undefined && !isTabRange(input.range)) return { ok: false, message: "Choose Summary window or All my open tasks." };
        if (input.sections !== undefined && !(BOARD_SECTIONS as readonly string[]).includes(input.sections)) return { ok: false, message: "Choose By date or My sections." };
        const source = await repo.findTab(owner, tab.id, db);
        const current = source?.config && typeof source.config === "object" ? (source.config as Record<string, unknown>) : {};
        const next = { ...current, ...tabSettings(current), ...(input.range !== undefined ? { range: input.range } : {}), ...(input.sections !== undefined ? { sections: input.sections } : {}) };
        await repo.updateWorkView(tab.id, { config: next }, db);
        await audit("settings", { tab: tab.id, range: next.range, sections: next.sections });
        return { ok: true, value: { id: tab.id }, message: "Saved." };
      }
    }
  }
}
