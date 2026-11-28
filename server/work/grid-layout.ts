import { z } from "zod";
import { GRID_COLUMNS, type GridConfig } from "@/server/work/grid";

// v1.95.0 (D-475..D-477, owner: "a changed column order view can be saved so that
// everytime a person opens the screen it stays the same"). A task table's layout:
// which columns are hidden and their order. Pure and unit-tested.
//
// Where a change goes (decided, D-476):
// - a view the person may save (their own Task Summary tab, a project tab they own
//   or edit, a D-220 saved tab they may update): saved into that view a second
//   after the change, like Task Summary tabs already do (D-401), so it is never
//   lost silently; the rest of the view (filters, sort, groups) keeps its own
//   Unsaved changes / Save view;
// - anywhere else (task search, a project tab they may only view, someone else's
//   Task Summary, a screen with no saved tab): a personal layout kept on the
//   person's account (user_settings `work.layout.<key>`), laid over that screen's
//   view every time they open it. Only the layout; never anyone else's view.
export const LAYOUT_SETTING_PREFIX = "work.layout.";
const COLUMN_KEY = /^(?:[a-zA-Z]{2,20}|f\d{1,10})$/;
export const gridLayoutSchema = z.object({
  hidden: z.array(z.enum(GRID_COLUMNS)).max(GRID_COLUMNS.length * 2).default([]),
  hiddenFields: z.array(z.number().int().positive().max(1e10)).max(500).default([]),
  columnOrder: z.array(z.string().regex(COLUMN_KEY)).max(520).default([]),
});
export type GridLayout = z.infer<typeof gridLayoutSchema>;

// The screen a personal layout belongs to: task search, or one tab of a project
// or of someone's Task Summary ("t12" stored, "vLIST" built in), or a screen without tabs.
const KEY = /^(?:search|(?:PROJECT|MY_TASKS)\.\d{1,10}\.(?:t\d{1,10}|v[A-Z]{4,9}|none))$/;
export const isLayoutKey = (key: unknown): key is string => typeof key === "string" && KEY.test(key);
export const layoutKey = (scope: "PROJECT" | "MY_TASKS", scopeId: number, tabKey: string | null | undefined) => `${scope}.${scopeId}.${tabKey && /^(?:t\d{1,10}|v[A-Z]{4,9})$/.test(tabKey) ? tabKey : "none"}`;

export const layoutOf = (config: Pick<GridConfig, "hidden" | "hiddenFields" | "columnOrder">): GridLayout => ({ hidden: [...config.hidden], hiddenFields: [...(config.hiddenFields ?? [])], columnOrder: [...(config.columnOrder ?? [])] });
export const sameLayout = (a: GridLayout, b: GridLayout) => JSON.stringify(a) === JSON.stringify(b);

// A stored layout, or null when there is none (or it isn't valid any more).
export function parseLayout(raw: string | null | undefined): GridLayout | null {
  if (!raw) return null;
  try {
    const parsed = gridLayoutSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
// The view with the person's layout laid over it (filters, sort and groups untouched).
export function withLayout(config: GridConfig, layout: GridLayout | null): GridConfig {
  return layout ? { ...config, hidden: [...layout.hidden], hiddenFields: [...layout.hiddenFields], columnOrder: [...layout.columnOrder] } : config;
}
