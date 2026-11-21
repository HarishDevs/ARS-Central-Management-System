import { z } from "zod";

// v1.62.0 (D-368, PM phase A part 2): pure rules for reactions, the task
// pane, celebrations, the sidebar's project lists and the 30-day purge
// (unit-tested in tests/work/pm-rules.test.ts). No database here.

// ---- reactions (spec CMP-30/31: reaction pills with aria-pressed) ----------------------
export const REACTIONS = [
  { key: "THUMBS_UP", emoji: "👍", name: "thumbs up" },
  { key: "HEART", emoji: "❤️", name: "heart" },
  { key: "TADA", emoji: "🎉", name: "celebrate" },
  { key: "SMILE", emoji: "😄", name: "smile" },
  { key: "EYES", emoji: "👀", name: "looking" },
  { key: "CHECK", emoji: "✅", name: "done" },
] as const;
export type ReactionKey = (typeof REACTIONS)[number]["key"];
export const isReaction = (value: unknown): value is ReactionKey => typeof value === "string" && REACTIONS.some((item) => item.key === value);
export interface ReactionCount {
  key: ReactionKey;
  count: number;
  mine: boolean;
}
// The accessible name of a reaction pill: "thumbs up: 3 people, including you".
export function reactionLabel(key: ReactionKey, count: number, mine: boolean): string {
  const name = REACTIONS.find((item) => item.key === key)?.name ?? key;
  if (count === 0) return `React with ${name}`;
  const people = `${count} ${count === 1 ? "person" : "people"}`;
  return `${name}: ${people}${mine ? (count === 1 ? " (you)" : ", including you") : ""}. ${mine ? "Remove your reaction" : "Add your reaction"}`;
}
// Rows from the database (comment, reaction, count, mine) grouped by comment, in the fixed order.
export function groupReactions(rows: readonly { commentId: number; key: string; count: number; mine: boolean }[]): Map<number, ReactionCount[]> {
  const out = new Map<number, ReactionCount[]>();
  for (const row of rows) {
    if (!isReaction(row.key) || row.count <= 0) continue;
    out.set(row.commentId, [...(out.get(row.commentId) ?? []), { key: row.key, count: row.count, mine: row.mine }]);
  }
  const order = (key: ReactionKey) => REACTIONS.findIndex((item) => item.key === key);
  for (const list of out.values()) list.sort((a, b) => order(a.key) - order(b.key));
  return out;
}

// ---- task pane (spec CMP-27: 440 px, resizable 380–720) -------------------------------
export const PANE_MIN = 380;
export const PANE_MAX = 720;
export const PANE_DEFAULT = 440;
export const PANE_SETTING = "work.pane_w";
export function clampPaneWidth(value: unknown): number {
  const width = typeof value === "number" ? value : typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(width)) return PANE_DEFAULT;
  return Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, width)));
}

// ---- celebrations (spec §14; DEC-011 original animation) -------------------------------
export const CELEBRATIONS = ["OFF", "OCCASIONAL", "ALWAYS"] as const;
export type Celebration = (typeof CELEBRATIONS)[number];
export const CELEBRATION_SETTING = "work.celebrations";
export const CELEBRATION_LABEL: Record<Celebration, string> = { OFF: "Off", OCCASIONAL: "Occasional", ALWAYS: "Always" };
export const parseCelebration = (value: unknown): Celebration | null => (CELEBRATIONS as readonly unknown[]).includes(value) ? (value as Celebration) : null;
// Occasional: about one completion in four (the spec's 0.25), never with reduced motion.
export const OCCASIONAL_CHANCE = 0.25;
export function shouldCelebrate(choice: Celebration, reducedMotion: boolean, random: number): boolean {
  if (reducedMotion || choice === "OFF") return false;
  return choice === "ALWAYS" || random < OCCASIONAL_CHANCE;
}

// Admin → Task settings: the celebration default for everyone and the purge switch.
export const PM_EXTRAS_KEY = "tasks.pm_extras";
export const pmExtrasSchema = z.object({
  celebrations: z.enum(CELEBRATIONS).default("OCCASIONAL"),
  purge: z.boolean().default(true),
});
export type PmExtras = z.infer<typeof pmExtrasSchema>;
export function parsePmExtras(raw: string | null | undefined): PmExtras {
  let value: unknown = {};
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    value = {};
  }
  const parsed = pmExtrasSchema.safeParse(value);
  return parsed.success ? parsed.data : pmExtrasSchema.parse({});
}

// ---- sidebar project lists -------------------------------------------------------------
export const SIDEBAR_LISTS = ["STARRED", "DEPARTMENTS"] as const;
export type SidebarList = (typeof SIDEBAR_LISTS)[number];
export const SIDEBAR_SORTS = ["MANUAL", "AZ", "RECENT"] as const;
export type SidebarSort = (typeof SIDEBAR_SORTS)[number];
export const SIDEBAR_SORT_LABEL: Record<SidebarSort, string> = { MANUAL: "Manual", AZ: "A–Z", RECENT: "Recently opened" };
export const sidebarSortSetting = (list: SidebarList) => (list === "STARRED" ? "work.sidebar_starred_sort" : "work.sidebar_departments_sort");
export const parseSidebarSort = (value: unknown, list: SidebarList): SidebarSort => ((SIDEBAR_SORTS as readonly unknown[]).includes(value) ? (value as SidebarSort) : list === "STARRED" ? "MANUAL" : "AZ");
export interface SidebarProject {
  id: number;
  name: string;
  color: string;
  position: number | null; // the person's manual place (null: never moved)
  openedAt: string | null; // ISO, when the person last opened it
  starredAt: string | null; // ISO
}
// Manual: the person's places first (in order), then the rest by when they
// were starred (Starred) or by name (Departments). A–Z by name. Recent: last
// opened first, never-opened last by name.
export function sortSidebar(items: readonly SidebarProject[], sort: SidebarSort): SidebarProject[] {
  const byName = (a: SidebarProject, b: SidebarProject) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id - b.id;
  const list = [...items];
  if (sort === "AZ") return list.sort(byName);
  if (sort === "RECENT") return list.sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? "") || byName(a, b));
  return list.sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position || byName(a, b);
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return (a.starredAt ?? "").localeCompare(b.starredAt ?? "") || byName(a, b);
  });
}
// Moving one project up or down in the manual order: the new full order
// (every item gets a place, 1024 apart), or null when it can't move.
export function moveInOrder(ids: readonly number[], id: number, direction: "up" | "down"): number[] | null {
  const index = ids.indexOf(id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

// ---- purge after 30 days in Deleted (BR-DEL-001/002) -----------------------------------
export const PURGE_DAYS = 30;
// When an item deleted at `deletedAt` is purged (the first job run after this).
export function purgeDueAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + PURGE_DAYS * 86_400_000);
}
// Whole days left before the purge (0 when due).
export function daysUntilPurge(deletedAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((purgeDueAt(deletedAt).getTime() - now.getTime()) / 86_400_000));
}
// Which candidate tasks may go: a task goes only when every one of its
// subtasks goes too (a subtask that stays, e.g. a restored one or a request's
// work step, keeps its parent). Returns them deepest first, the order rows
// must be deleted in (subtasks before their parents).
export function purgeableTasks(candidates: readonly { id: number; parentId: number | null; depth: number }[], children: ReadonlyMap<number, readonly number[]>): number[] {
  const candidateIds = new Set(candidates.map((task) => task.id));
  const memo = new Map<number, boolean>();
  const ok = (id: number, seen: Set<number>): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    if (!candidateIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    const result = (children.get(id) ?? []).every((child) => ok(child, seen));
    memo.set(id, result);
    return result;
  };
  return candidates
    .filter((task) => ok(task.id, new Set()))
    .sort((a, b) => b.depth - a.depth || b.id - a.id)
    .map((task) => task.id);
}
// What the Deleted lists say about an item: when it goes for good.
const PURGE_DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
export function purgeText(deletedAt: Date, now: Date, active: boolean): string {
  if (!active) return "Kept until restored (automatic removal is off)";
  const days = daysUntilPurge(deletedAt, now);
  return days === 0 ? "Removed for good at the next clean-up" : `Removed for good on ${PURGE_DAY.format(purgeDueAt(deletedAt))} (in ${days} day${days === 1 ? "" : "s"})`;
}
