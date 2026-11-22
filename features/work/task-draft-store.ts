// v1.78.0 (D-405, spec §3.1 "Draft task survives navigation"): the Create
// task panel's draft is kept in this browser tab (sessionStorage) so a reload
// doesn't lose it; it is cleared when the task is created or the panel is
// closed. Only a plain task (not a subtask or milestone). Nothing goes to the
// server until Create. Pure apart from the storage passed in (unit-tested).
export const DRAFT_KEY = "ars.work.taskDraft.v1";
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // a day-old draft is dropped
const PRIORITIES = ["LOW", "NORMAL", "ELEVATED", "IMPORTANT", "HIGH", "URGENT"] as const;
export type DraftPriority = (typeof PRIORITIES)[number];
export interface TaskDraft {
  title: string;
  description: string;
  projectId: number | null;
  due: string; // YYYY-MM-DD or ""
  start: string;
  dueTime: string; // HH:MM
  forWhom: "self" | "others";
  others: number[];
  priority: DraftPriority;
  savedAt: number;
}
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");

// Something worth keeping: a name or a description.
export const draftWorthKeeping = (draft: Pick<TaskDraft, "title" | "description">) => draft.title.trim().length > 0 || draft.description.trim().length > 0;

export function readDraft(store: Store | null, now = Date.now()): TaskDraft | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const savedAt = Number(value.savedAt);
    if (!Number.isFinite(savedAt) || now - savedAt > DRAFT_MAX_AGE_MS) return null;
    const draft: TaskDraft = {
      title: typeof value.title === "string" ? value.title.slice(0, 200) : "",
      description: typeof value.description === "string" ? value.description.slice(0, 20000) : "",
      projectId: Number.isInteger(value.projectId) && Number(value.projectId) > 0 ? Number(value.projectId) : null,
      due: day(value.due),
      start: day(value.start),
      dueTime: typeof value.dueTime === "string" && /^\d{2}:\d{2}$/.test(value.dueTime) ? value.dueTime : "23:59",
      forWhom: value.forWhom === "others" ? "others" : "self",
      others: Array.isArray(value.others) ? value.others.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 50) : [],
      priority: (PRIORITIES as readonly unknown[]).includes(value.priority) ? (value.priority as DraftPriority) : "NORMAL",
      savedAt,
    };
    return draftWorthKeeping(draft) ? draft : null;
  } catch {
    return null;
  }
}

export function writeDraft(store: Store | null, draft: Omit<TaskDraft, "savedAt">, now = Date.now()): void {
  if (!store) return;
  try {
    if (draftWorthKeeping(draft)) store.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: now }));
    else store.removeItem(DRAFT_KEY);
  } catch {
    // Private windows and full storage: the draft just isn't kept.
  }
}

export function clearDraft(store: Store | null): void {
  try {
    store?.removeItem(DRAFT_KEY);
  } catch {
    // nothing to do
  }
}

// The browser's sessionStorage, or null where it can't be used.
export function sessionStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
