import { z } from "zod";

// v1.63.0 (D-369, PM-A12, spec HOME_MODULE §3–§6): the person's Home widgets.
// A registry of widget kinds (title, sizes, which module each needs); the
// layout is a list of { kind, size } kept per person (home_layouts). Pure and
// unit-tested; the repository stores it, the action checks it, the board draws it.
export const WIDGET_KINDS = ["my_tasks", "projects", "status_updates", "notepad", "workload", "assigned", "people", "forms"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];
export type WidgetSize = "half" | "full";
export interface WidgetEntry {
  kind: WidgetKind;
  title: string;
  description: string;
  needs: "TASK" | "PROJECT" | null; // the module the widget's data comes from
  defaultSize: WidgetSize;
  sizes: readonly WidgetSize[];
  available: boolean; // false: listed for a later phase, hidden until then
}
export const WIDGETS: readonly WidgetEntry[] = [
  { kind: "my_tasks", title: "My Tasks", description: "Your tasks: upcoming, overdue and completed.", needs: "TASK", defaultSize: "full", sizes: ["full", "half"], available: true },
  { kind: "projects", title: "Projects", description: "Projects you opened lately, and the ones you starred.", needs: "PROJECT", defaultSize: "half", sizes: ["half", "full"], available: true },
  { kind: "status_updates", title: "Latest status updates", description: "Status updates from your projects and news on your tasks.", needs: "TASK", defaultSize: "half", sizes: ["half", "full"], available: true },
  { kind: "notepad", title: "Private notepad", description: "A note only you can see.", needs: null, defaultSize: "half", sizes: ["half", "full"], available: true },
  { kind: "workload", title: "My weekly workload", description: "Tasks given to you and completed, day by day.", needs: "TASK", defaultSize: "half", sizes: ["half", "full"], available: true },
  { kind: "assigned", title: "Tasks I've assigned", description: "Tasks you gave others: this week, upcoming, overdue, completed.", needs: "TASK", defaultSize: "half", sizes: ["half", "full"], available: true },
  { kind: "people", title: "People", description: "Your reporting line: who you report to, and your team's open and overdue tasks.", needs: "TASK", defaultSize: "full", sizes: ["full", "half"], available: true },
  // Phase C (project intake forms) fills this one; hidden until then.
  { kind: "forms", title: "Forms", description: "Forms you use and share.", needs: "PROJECT", defaultSize: "half", sizes: ["half", "full"], available: false },
];
export const widgetEntry = (kind: WidgetKind): WidgetEntry => WIDGETS.find((entry) => entry.kind === kind)!;
export const MAX_WIDGETS = 20; // BR-HOME-011
export const NOTE_MAX = 50_000; // spec §6 validation

export interface WidgetItem {
  kind: WidgetKind;
  size: WidgetSize;
}
export interface HomeAccess {
  tasks: boolean; // the Tasks module and switch
  projects: boolean; // the Projects module
}

// The widgets a person may have. Without Tasks only the notepad; without
// Projects nothing that shows projects (D-307: their placeholders are locked).
export function availableKinds(access: HomeAccess): WidgetKind[] {
  return WIDGETS.filter((entry) => entry.available && (entry.needs === null || (entry.needs === "TASK" ? access.tasks : access.tasks && access.projects))).map((entry) => entry.kind);
}

// The layout a person starts with (spec §4.1 order, our widgets).
export function defaultLayout(access: HomeAccess): WidgetItem[] {
  const allowed = new Set(availableKinds(access));
  return WIDGETS.filter((entry) => allowed.has(entry.kind)).map((entry) => ({ kind: entry.kind, size: entry.defaultSize }));
}

const itemSchema = z.object({ kind: z.enum(WIDGET_KINDS), size: z.enum(["half", "full"]) }).strict();
export const layoutSchema = z.array(itemSchema).max(MAX_WIDGETS);

// Strict check of what a person saves: known kinds they may have, each once
// (BR-HOME-010; one notepad), a size that kind offers, at most 20.
export function validLayout(raw: unknown, access: HomeAccess): WidgetItem[] | null {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) return null;
  const allowed = new Set(availableKinds(access));
  const seen = new Set<WidgetKind>();
  for (const item of parsed.data) {
    if (!allowed.has(item.kind) || seen.has(item.kind)) return null;
    if (!widgetEntry(item.kind).sizes.includes(item.size)) return null;
    seen.add(item.kind);
  }
  return parsed.data;
}

// Reading a stored layout: lenient. Unknown, repeated or no-longer-allowed
// widgets are left out (a module taken away hides its widgets; given back,
// they return only if the person adds them). Nothing stored: the default.
export function readLayout(stored: unknown, access: HomeAccess): WidgetItem[] {
  if (!Array.isArray(stored)) return defaultLayout(access);
  const allowed = new Set(availableKinds(access));
  const seen = new Set<WidgetKind>();
  const out: WidgetItem[] = [];
  for (const raw of stored) {
    const item = itemSchema.safeParse(raw);
    if (!item.success || !allowed.has(item.data.kind) || seen.has(item.data.kind)) continue;
    seen.add(item.data.kind);
    out.push({ kind: item.data.kind, size: widgetEntry(item.data.kind).sizes.includes(item.data.size) ? item.data.size : widgetEntry(item.data.kind).defaultSize });
    if (out.length >= MAX_WIDGETS) break;
  }
  return out;
}

// The "Add widget" menu: allowed kinds not on Home yet.
export const addableWidgets = (layout: readonly WidgetItem[], access: HomeAccess): WidgetEntry[] =>
  availableKinds(access)
    .filter((kind) => !layout.some((item) => item.kind === kind))
    .map(widgetEntry);

// ---- changes (used by the board and checked again on the server) -----------------------
export function moveWidget(layout: readonly WidgetItem[], kind: WidgetKind, delta: number): WidgetItem[] {
  const from = layout.findIndex((item) => item.kind === kind);
  if (from < 0) return [...layout];
  const to = Math.min(layout.length - 1, Math.max(0, from + delta));
  const out = [...layout];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}
export function placeWidget(layout: readonly WidgetItem[], kind: WidgetKind, beforeKind: WidgetKind | null): WidgetItem[] {
  const item = layout.find((one) => one.kind === kind);
  if (!item || kind === beforeKind) return [...layout];
  const rest = layout.filter((one) => one.kind !== kind);
  const at = beforeKind === null ? rest.length : rest.findIndex((one) => one.kind === beforeKind);
  rest.splice(at < 0 ? rest.length : at, 0, item);
  return rest;
}
export const addWidget = (layout: readonly WidgetItem[], kind: WidgetKind): WidgetItem[] =>
  layout.some((item) => item.kind === kind) || layout.length >= MAX_WIDGETS ? [...layout] : [...layout, { kind, size: widgetEntry(kind).defaultSize }];
export const removeWidget = (layout: readonly WidgetItem[], kind: WidgetKind): WidgetItem[] => layout.filter((item) => item.kind !== kind);
export const resizeWidget = (layout: readonly WidgetItem[], kind: WidgetKind, size: WidgetSize): WidgetItem[] =>
  layout.map((item) => (item.kind === kind && widgetEntry(kind).sizes.includes(size) ? { ...item, size } : item));

// ---- the greeting (BR-HOME-002) ----------------------------------------------------------
// By the hour in India, like the rest of the app; the first name (or both
// words of a two-word name, as Home did before).
export function greetingFor(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
export function greetingName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length <= 2 ? words.join(" ") : words[0]!;
}
export function homeDate(now: Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(now);
}

// ---- the notepad ---------------------------------------------------------------------------
// The app's plain formatting text (features/work/rich-text.ts), never HTML.
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return text.length > NOTE_MAX ? null : text;
}
