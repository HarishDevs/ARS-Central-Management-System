// v1.71.0 (D-384, PM phase E part 2): pure rules for the project's Files,
// Messages and Page tabs and for time tracking on tasks (unit-tested in
// tests/work/collab-rules.test.ts). No database here.
import { mentionIds } from "@/features/work/rich-text";

// ---- files --------------------------------------------------------------------------------
export const FILE_KINDS = ["image", "pdf", "document", "sheet", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_LABEL: Record<FileKind, string> = { image: "Images", pdf: "PDFs", document: "Documents", sheet: "Spreadsheets", other: "Other files" };
export function fileKind(contentType: string, name = ""): FileKind {
  const type = contentType.toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv" || ["xlsx", "xls", "csv", "ods"].includes(ext)) return "sheet";
  if (type.includes("word") || type.includes("document") || type.includes("presentation") || type.startsWith("text/") || ["doc", "docx", "txt", "ppt", "pptx", "odt", "rtf"].includes(ext)) return "document";
  return "other";
}

export type FileSource = "TASK" | "FORM" | "MESSAGE";
export const FILE_SOURCE_LABEL: Record<FileSource, string> = { TASK: "Task", FORM: "Form submission", MESSAGE: "Message" };
export interface FileItem {
  id: number;
  name: string;
  contentType: string;
  size: number;
  createdAt: string; // ISO
  uploaderId: number;
  uploaderName: string;
  source: FileSource;
  taskId: number | null;
  taskNo: string | null;
  taskTitle: string | null;
  messageId: number | null; // the thread it is in (a reply's thread)
  messageSubject: string | null;
}
export interface FileFilter {
  kind: FileKind | "";
  taskId: number | null;
  uploaderId: number | null;
  from: string; // YYYY-MM-DD (India day), "" = any
  to: string;
  search: string;
}
export const EMPTY_FILE_FILTER: FileFilter = { kind: "", taskId: null, uploaderId: null, from: "", to: "", search: "" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const positive = (value: unknown) => (typeof value === "string" && /^\d{1,10}$/.test(value) && Number(value) > 0 ? Number(value) : null);
// From the address (?fkind=…&ftask=…&fby=…&ffrom=…&fto=…&fq=…); anything odd is dropped.
export function parseFileFilter(query: Record<string, string | undefined>): FileFilter {
  const kind = query.fkind && (FILE_KINDS as readonly string[]).includes(query.fkind) ? (query.fkind as FileKind) : "";
  return {
    kind,
    taskId: positive(query.ftask),
    uploaderId: positive(query.fby),
    from: DAY.test(query.ffrom ?? "") ? query.ffrom! : "",
    to: DAY.test(query.fto ?? "") ? query.fto! : "",
    search: (query.fq ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 100),
  };
}
const indiaDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
export function filterFiles<T extends FileItem>(files: readonly T[], filter: FileFilter): T[] {
  const words = filter.search.toLowerCase().split(/\s+/).filter(Boolean);
  return files.filter((file) => {
    if (filter.kind && fileKind(file.contentType, file.name) !== filter.kind) return false;
    if (filter.taskId && file.taskId !== filter.taskId) return false;
    if (filter.uploaderId && file.uploaderId !== filter.uploaderId) return false;
    const day = indiaDay(file.createdAt);
    if (filter.from && day < filter.from) return false;
    if (filter.to && day > filter.to) return false;
    if (words.length) {
      const hay = `${file.name} ${file.taskTitle ?? ""} ${file.taskNo ?? ""} ${file.messageSubject ?? ""} ${file.uploaderName}`.toLowerCase();
      if (!words.every((word) => hay.includes(word))) return false;
    }
    return true;
  });
}
export const FILE_SORTS = ["newest", "oldest", "name", "size"] as const;
export type FileSort = (typeof FILE_SORTS)[number];
export function sortFiles<T extends FileItem>(files: readonly T[], sort: FileSort): T[] {
  const out = [...files];
  if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name) || b.id - a.id);
  else if (sort === "size") out.sort((a, b) => b.size - a.size || b.id - a.id);
  else if (sort === "oldest") out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  else out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return out;
}

// ---- messages -----------------------------------------------------------------------------
export const SUBJECT_MAX = 150;
export const MESSAGE_MAX = 10_000;
export const MESSAGE_FILES_MAX = 10;
const clean = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : null);
// A subject: one line, 1–150 characters.
export function cleanSubject(raw: unknown): string | null {
  const text = clean(raw)?.replace(/\s+/g, " ").trim() ?? "";
  return text.length >= 1 && text.length <= SUBJECT_MAX ? text : null;
}
// A body (the app's formatting text): 1..max characters, not only spaces.
export function cleanBody(raw: unknown, max = MESSAGE_MAX): string | null {
  const text = clean(raw)?.replace(/\s+$/g, "").replace(/^\n+/, "") ?? "";
  return text.trim().length >= 1 && text.length <= max ? text : null;
}
// Who is told about a new message: on a new thread, the project's members
// (people, not departments); on a reply, the thread's author and everyone
// who replied; plus anyone @mentioned who may see the project. Never the
// writer; each person once.
export function messageRecipients(input: { authorId: number; members: readonly number[]; threadPeople: readonly number[] | null; mentioned: readonly number[]; mayView: (id: number) => boolean }): { notify: number[]; mentions: number[]; cannotSee: number[] } {
  const mentions = [...new Set(input.mentioned)].filter((id) => id !== input.authorId);
  const cannotSee = mentions.filter((id) => !input.mayView(id));
  const seen = mentions.filter((id) => input.mayView(id));
  const base = (input.threadPeople ?? input.members).filter((id) => id !== input.authorId && input.mayView(id) && !seen.includes(id));
  return { notify: [...new Set(base)], mentions: seen, cannotSee };
}
export const messageMentions = (body: string) => mentionIds(body);

// ---- page ---------------------------------------------------------------------------------
export const PAGE_TITLE_MAX = 150;
export const PAGE_MAX = 100_000;
export const PAGE_VERSIONS_KEEP = 50;
export function cleanPageTitle(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  const text = clean(raw)?.replace(/\s+/g, " ").trim();
  return text !== undefined && text.length <= PAGE_TITLE_MAX ? text : null;
}
// The page may be empty (a cleared page), up to 100,000 characters.
export function cleanPageBody(raw: unknown): string | null {
  const text = clean(raw);
  return text !== null && text.length <= PAGE_MAX ? text.replace(/\s+$/g, "") : null;
}
// People mentioned now who weren't before (only they are told when the page is saved).
export function newMentions(before: string, after: string): number[] {
  const had = new Set(mentionIds(before));
  return mentionIds(after).filter((id) => !had.has(id));
}
// Tasks linked from the text: links to …/users/tasks/<id> (in order, each once, at most 50).
export function taskLinkIds(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/\]\((?:https?:\/\/[^\s)/]+)?\/users\/tasks\/(\d{1,10})(?:[?#][^\s)]*)?\)/g)) {
    const id = Number(match[1]);
    if (id > 0 && !out.includes(id)) out.push(id);
    if (out.length >= 50) break;
  }
  return out;
}
// The version numbers beyond the newest `keep` (to remove after a save).
export function versionsToDrop(versionNos: readonly number[], keep = PAGE_VERSIONS_KEEP): number[] {
  return [...versionNos].sort((a, b) => b - a).slice(keep);
}
// The text that links a task into the page: "[TSK-…: title](origin/users/tasks/id)".
export function taskLinkText(origin: string, task: { id: number; taskNo: string; title: string }): string {
  const label = `${task.taskNo}: ${task.title}`.replace(/[[\]\n]/g, " ").slice(0, 190);
  return `[${label}](${origin.replace(/\/+$/, "")}/users/tasks/${task.id})`;
}

// ---- time tracking ------------------------------------------------------------------------
export const ENTRY_MAX_MINUTES = 24 * 60; // one entry is at most a day
export const ESTIMATE_MAX_MINUTES = 10_000 * 60;
export const NOTE_MAX = 500;
export const BACKDATE_DAYS = 366;
// "1h 30m", "1h", "45m", "1:30", "1.5h", "1.5" (hours), "90" (minutes when no unit and ≥ 10, else hours).
// Returns minutes, or null when it can't be read or is 0.
export function parseDuration(raw: unknown, max = ENTRY_MAX_MINUTES): number | null {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 && raw <= max ? raw : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  let minutes: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,5}):([0-5]\d)$/.exec(text))) minutes = Number(match[1]) * 60 + Number(match[2]);
  else if ((match = /^(?:(\d{1,5}(?:\.\d{1,2})?) ?h(?:rs?|ours?)?)? ?(?:(\d{1,5}) ?m(?:in(?:ute)?s?)?)?$/.exec(text)) && (match[1] || match[2])) minutes = Math.round(Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0);
  else if ((match = /^(\d{1,5}(?:\.\d{1,2})?)$/.exec(text))) {
    const value = Number(match[1]);
    minutes = text.includes(".") || value < 10 ? Math.round(value * 60) : value;
  }
  return minutes !== null && minutes > 0 && minutes <= max ? minutes : null;
}
// An estimate: like a duration (up to 10,000 hours); empty = no estimate (null); unreadable = undefined.
export function parseEstimate(raw: unknown): number | null | undefined {
  if (raw === null || raw === "" || (typeof raw === "string" && !raw.trim())) return null;
  const minutes = parseDuration(raw, ESTIMATE_MAX_MINUTES);
  return minutes === null ? undefined : minutes;
}
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
// The day time was spent: a real day, not after today, not more than a year back.
export function checkWorkDay(day: unknown, today: string): string | null {
  if (typeof day !== "string" || !DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  if (day > today) return null;
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - BACKDATE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return day < earliest ? null : day;
}
export function cleanNote(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= NOTE_MAX ? text : undefined;
}
// A start/stop entry's minutes when stopped: at least 1, at most a day.
export function elapsedMinutes(startedAt: Date, now: Date): { minutes: number; capped: boolean } {
  const raw = Math.round((now.getTime() - startedAt.getTime()) / 60_000);
  return { minutes: Math.min(ENTRY_MAX_MINUTES, Math.max(1, raw)), capped: raw > ENTRY_MAX_MINUTES };
}
// Who may change an entry: its person, IT, and the owners/editors of a
// project the task is in (others' entries; audited).
export function mayChangeEntry(entryUserId: number, actor: { id: number; isAdmin: boolean; projectRole: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER" | null }): boolean {
  return entryUserId === actor.id || actor.isAdmin || actor.projectRole === "OWNER" || actor.projectRole === "EDITOR";
}
export interface TimeEntryLite {
  userId: number;
  userName: string;
  minutes: number | null;
}
export function timeTotals(entries: readonly TimeEntryLite[]): { total: number; people: { userId: number; name: string; minutes: number }[] } {
  const people = new Map<number, { userId: number; name: string; minutes: number }>();
  let total = 0;
  for (const entry of entries) {
    if (entry.minutes === null) continue;
    total += entry.minutes;
    const person = people.get(entry.userId) ?? { userId: entry.userId, name: entry.userName, minutes: 0 };
    person.minutes += entry.minutes;
    people.set(entry.userId, person);
  }
  return { total, people: [...people.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name)) };
}
// "2h 30m of 4h (63%)" style progress against the estimate.
export function estimateProgress(logged: number, estimate: number | null): { percent: number | null; over: boolean } {
  if (!estimate) return { percent: null, over: false };
  return { percent: Math.round((logged / estimate) * 100), over: logged > estimate };
}
export const TIME_CSV_HEADER = ["Date", "Person", "Task ID", "Task", "Section", "Hours", "Minutes", "Note", "How", "Logged on"];
