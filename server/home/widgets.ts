import { z } from "zod";

// v1.63.0 (D-369, PM-A12, spec HOME_MODULE §3–§6): the person's Home widgets.
// A registry of widget kinds (title, sizes, which module each needs); the
// layout is a list of { kind, size } kept per person (home_layouts). Pure and
// unit-tested; the repository stores it, the action checks it, the board draws it.
// v1.79.0 (D-406, owner: "Match all 3 Overview Screens, it should be
// identically featured"): every Home overview (scope) has its own widgets and
// each person keeps one layout per overview. Four standard widgets exist on
// all three (Private notepad, a day-by-day chart, Needs attention, Quick
// insights); each overview's own sections are widgets too. The notepad is one
// note per person, shared by the three overviews (chosen; D-406).
export const OVERVIEW_SCOPES = ["approvals", "tasks", "meetings"] as const;
export type OverviewScope = (typeof OVERVIEW_SCOPES)[number];
export const isOverviewScope = (value: unknown): value is OverviewScope => typeof value === "string" && (OVERVIEW_SCOPES as readonly string[]).includes(value);

export const WIDGET_KINDS = [
  "my_tasks",
  "projects",
  "status_updates",
  "notepad",
  "workload",
  "assigned",
  "people",
  "forms",
  "task_attention",
  "task_insights",
  "ap_waiting",
  "ap_due",
  "ap_returned",
  "ap_recent",
  "ap_drafts",
  "ap_insights",
  "ap_attention",
  "ap_chart",
  "mt_attention",
  "mt_upcoming",
  "mt_actions",
  "mt_approve",
  "mt_confirm",
  "mt_insights",
  "mt_figures",
  "mt_register",
  "mt_chart",
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];
export type WidgetSize = "half" | "full";
// The module (or page access) the widget's data comes from. FORMS: the
// "pm_forms" switch (D-374); MEETING_FIGURES: the "Meetings: dashboard
// figures" page access.
export type WidgetNeed = "TASK" | "PROJECT" | "FORMS" | "APPROVAL" | "MEETING" | "MEETING_FIGURES" | null;
export interface WidgetEntry {
  kind: WidgetKind;
  title: string;
  description: string;
  needs: WidgetNeed;
  scopes: readonly OverviewScope[]; // the overviews it can be added to
  defaultSize: WidgetSize;
  sizes: readonly WidgetSize[];
  available: boolean; // false: listed for a later phase, hidden until then
}
const T: readonly OverviewScope[] = ["tasks"];
const A: readonly OverviewScope[] = ["approvals"];
const M: readonly OverviewScope[] = ["meetings"];
const BOTH: readonly WidgetSize[] = ["half", "full"];
const FULL_FIRST: readonly WidgetSize[] = ["full", "half"];
export const WIDGETS: readonly WidgetEntry[] = [
  { kind: "my_tasks", title: "My Tasks", description: "Your tasks: upcoming, overdue and completed.", needs: "TASK", scopes: T, defaultSize: "full", sizes: FULL_FIRST, available: true },
  { kind: "projects", title: "Projects", description: "Projects you opened lately, and the ones you starred.", needs: "PROJECT", scopes: T, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "status_updates", title: "Latest status updates", description: "Status updates from your projects and news on your tasks.", needs: "TASK", scopes: T, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "notepad", title: "Private notepad", description: "A note only you can see (the same note on every overview).", needs: null, scopes: OVERVIEW_SCOPES, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "workload", title: "My weekly workload", description: "Tasks given to you and completed, day by day.", needs: "TASK", scopes: T, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "assigned", title: "Tasks I've assigned", description: "Tasks you gave others: this week, upcoming, overdue, completed.", needs: "TASK", scopes: T, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "people", title: "People", description: "Your reporting line: who you report to, and your team's open and overdue tasks.", needs: "TASK", scopes: T, defaultSize: "full", sizes: FULL_FIRST, available: true },
  // v1.66.0 (D-374, phase C): forms the person may submit and their recent submissions.
  { kind: "forms", title: "Forms", description: "Forms you can submit, and your recent submissions.", needs: "FORMS", scopes: T, defaultSize: "half", sizes: BOTH, available: true },
  // v1.79.0 (D-406): the standard widgets on My Work.
  { kind: "task_attention", title: "Needs attention", description: "Your overdue tasks and tasks due today.", needs: "TASK", scopes: T, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "task_insights", title: "Quick insights", description: "Completion rate, on-time share and average days to complete, for the period.", needs: "TASK", scopes: T, defaultSize: "half", sizes: BOTH, available: true },
  // v1.79.0 (D-406): the Approvals overview's sections, then its standard widgets.
  { kind: "ap_waiting", title: "Waiting for me", description: "Requests waiting for your approval.", needs: "APPROVAL", scopes: A, defaultSize: "full", sizes: FULL_FIRST, available: true },
  { kind: "ap_due", title: "Due soon or overdue", description: "Your approval steps past their due time or due within 24 hours.", needs: "APPROVAL", scopes: A, defaultSize: "full", sizes: FULL_FIRST, available: true },
  { kind: "ap_returned", title: "Returned to you for changes", description: "Your requests sent back to you for changes.", needs: "APPROVAL", scopes: A, defaultSize: "full", sizes: FULL_FIRST, available: true },
  { kind: "ap_recent", title: "My recent requests", description: "Requests you raised, newest first, with pages and sorting.", needs: "APPROVAL", scopes: A, defaultSize: "full", sizes: FULL_FIRST, available: true },
  { kind: "ap_drafts", title: "Your drafts", description: "Requests you started and haven't submitted.", needs: "APPROVAL", scopes: A, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "ap_insights", title: "Quick insights", description: "Requests raised and approved, and the average approval time, for the period.", needs: "APPROVAL", scopes: A, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "ap_attention", title: "Needs attention", description: "Overdue and due-soon approval steps, and requests returned to you.", needs: "APPROVAL", scopes: A, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "ap_chart", title: "My approval activity", description: "Requests you raised and steps you decided, day by day.", needs: "APPROVAL", scopes: A, defaultSize: "half", sizes: BOTH, available: true },
  // v1.79.0 (D-406): the Meetings overview's sections, then its standard widgets.
  { kind: "mt_attention", title: "Needs attention", description: "Meeting points, MOMs and actions late or due soon.", needs: "MEETING", scopes: M, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "mt_upcoming", title: "Coming up", description: "Meetings scheduled and not yet held.", needs: "MEETING", scopes: M, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "mt_actions", title: "My action items", description: "Open action items from approved MOMs given to you.", needs: "MEETING", scopes: M, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "mt_approve", title: "Waiting for my approval", description: "Meeting points and MOMs sent to you to approve.", needs: "MEETING", scopes: M, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "mt_confirm", title: "Done, to confirm", description: "Completed actions in meetings you run, waiting for you to confirm.", needs: "MEETING", scopes: M, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "mt_insights", title: "Quick insights", description: "How meetings ran in the period, in plain words.", needs: "MEETING_FIGURES", scopes: M, defaultSize: "half", sizes: BOTH, available: true },
  { kind: "mt_figures", title: "How meetings are running", description: "The period's figures, by meeting type and by department.", needs: "MEETING_FIGURES", scopes: M, defaultSize: "full", sizes: FULL_FIRST, available: true },
  { kind: "mt_register", title: "Register", description: "The period's meetings, with duration, attendance and actions.", needs: "MEETING_FIGURES", scopes: M, defaultSize: "full", sizes: FULL_FIRST, available: true },
  { kind: "mt_chart", title: "My meeting activity", description: "Meetings you attended or held and actions you completed, day by day.", needs: "MEETING", scopes: M, defaultSize: "half", sizes: BOTH, available: true },
];
export const widgetEntry = (kind: WidgetKind): WidgetEntry => WIDGETS.find((entry) => entry.kind === kind)!;
export const MAX_WIDGETS = 20; // BR-HOME-011
export const NOTE_MAX = 50_000; // spec §6 validation

// Each overview's starting layout: today's screen, in today's order, so
// nothing disappears for anyone until they customise (D-406). The new
// standard widgets are offered under Add widgets.
const DEFAULT_KINDS: Record<OverviewScope, readonly WidgetKind[]> = {
  tasks: ["my_tasks", "projects", "status_updates", "notepad", "workload", "assigned", "people", "forms"],
  approvals: ["ap_waiting", "ap_due", "ap_returned", "ap_recent", "ap_drafts", "ap_insights"],
  meetings: ["mt_attention", "mt_upcoming", "mt_actions", "mt_approve", "mt_confirm", "mt_insights", "mt_figures", "mt_register"],
};

export interface WidgetItem {
  kind: WidgetKind;
  size: WidgetSize;
}
export interface HomeAccess {
  tasks: boolean; // the Tasks module and switch
  projects: boolean; // the Projects module
  forms?: boolean; // v1.66.0 (D-374): the "pm_forms" switch (project intake forms)
  approvals?: boolean; // v1.79.0 (D-406): the Approval module
  meetings?: boolean; // the Meeting module and its pages
  meetingFigures?: boolean; // the "Meetings: dashboard figures" page access
}

function allowedBy(need: WidgetNeed, access: HomeAccess): boolean {
  switch (need) {
    case null:
      return true;
    case "TASK":
      return access.tasks;
    case "PROJECT":
      return access.tasks && access.projects;
    case "FORMS":
      return access.tasks && Boolean(access.forms);
    case "APPROVAL":
      return Boolean(access.approvals);
    case "MEETING":
      return Boolean(access.meetings);
    case "MEETING_FIGURES":
      return Boolean(access.meetings && access.meetingFigures);
  }
}

// The widgets a person may have on an overview. Without Tasks only the
// notepad; without Projects nothing that shows projects (D-307: their
// placeholders are locked); meeting figures only with that page access.
export function availableKinds(access: HomeAccess, scope: OverviewScope = "tasks"): WidgetKind[] {
  return WIDGETS.filter((entry) => entry.available && entry.scopes.includes(scope) && allowedBy(entry.needs, access)).map((entry) => entry.kind);
}

// The layout a person starts with on an overview.
export function defaultLayout(access: HomeAccess, scope: OverviewScope = "tasks"): WidgetItem[] {
  const allowed = new Set(availableKinds(access, scope));
  const kinds = DEFAULT_KINDS[scope].filter((kind) => allowed.has(kind));
  // Without the overview's module only the notepad is left (as before for Tasks).
  return (kinds.length ? kinds : allowed.has("notepad") ? (["notepad"] as const) : []).map((kind) => ({ kind, size: widgetEntry(kind).defaultSize }));
}

const itemSchema = z.object({ kind: z.enum(WIDGET_KINDS), size: z.enum(["half", "full"]) }).strict();
export const layoutSchema = z.array(itemSchema).max(MAX_WIDGETS);

// Strict check of what a person saves: known kinds they may have on that
// overview, each once (BR-HOME-010; one notepad), a size that kind offers, at most 20.
export function validLayout(raw: unknown, access: HomeAccess, scope: OverviewScope = "tasks"): WidgetItem[] | null {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) return null;
  const allowed = new Set(availableKinds(access, scope));
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
export function readLayout(stored: unknown, access: HomeAccess, scope: OverviewScope = "tasks"): WidgetItem[] {
  if (!Array.isArray(stored)) return defaultLayout(access, scope);
  const allowed = new Set(availableKinds(access, scope));
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
export const addableWidgets = (layout: readonly WidgetItem[], access: HomeAccess, scope: OverviewScope = "tasks"): WidgetEntry[] =>
  availableKinds(access, scope)
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

// ---- figures (v1.79.0, D-406) ----------------------------------------------------------------
// The share as a whole percentage, or null when there is nothing to divide by.
export const sharePercent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

// A duration in hours as people read it: minutes under an hour, hours under a day, else days.
export function hoursText(hours: number | null): string {
  if (hours === null) return "N/A";
  if (hours < 1) return hours * 60 < 1 ? "< 1 min" : `${Math.round(hours * 60)} min`;
  return hours < 24 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} d`;
}
