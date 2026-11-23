"use client";

import { Check, Link2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { completeAction, deleteTaskAction } from "@/app/users/work/actions";
import { undoShiftAction } from "@/app/users/work/schedule-actions";
import { actionErrorMessage, guardCall, UNEXPECTED } from "@/features/ui/form";
import { useToast } from "@/features/ui/Toast";
import type { ActionResult } from "@/lib/http/action-result";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { useCelebrate, useCelebrationState } from "@/features/work/celebrate";
import { closeTopLayer } from "@/features/ui/top-layer";

// D-215: small shared pieces of the Task & Project Management screens.

// D-217: a date that lands on a holiday comes back as `holiday`; the person
// is asked (HolidayPrompt) to keep it or move it, and the call runs again.
export interface HolidayInfo {
  day: string;
  name: string;
  suggestion: string;
  mode: "WARN" | "BLOCK";
  field: "due" | "start";
  away?: boolean; // v1.54.5: the assignee is out of office that day
}
export type HolidayChoice = { holidayOk?: true; moveTo?: string };
const HOLIDAY_EVENT = "ars:task-holiday";
function askHoliday(info: HolidayInfo): Promise<HolidayChoice | null> {
  return new Promise((resolve) => {
    // The prompt takes the question (preventDefault); without one, nothing changes.
    const taken = !window.dispatchEvent(new CustomEvent(HOLIDAY_EVENT, { detail: { info, resolve }, cancelable: true }));
    if (!taken) resolve(null);
  });
}

// Run a server action from a click: errors become a toast; success refreshes
// the page so it shows what the server now holds.
// Undo of a shift (v1.65.0): put the moved dates back, and say so.
async function undoShiftOnce(batchId: number, toast: ReturnType<typeof useToast>, refresh: () => void) {
  try {
    const result = await undoShiftAction(batchId);
    toast({ tone: result.ok ? "success" : "error", title: result.message || (result.ok ? "Dates put back." : "Couldn't undo.") });
    if (result.ok) refresh();
  } catch (error) {
    toast({ tone: "error", title: actionErrorMessage(error) ?? UNEXPECTED });
  }
}

export function useWorkCall() {
  const toast = useToast();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  // D-233: busy while a call runs (callers disable their buttons), and every
  // call is guarded like a form: time limit, offline, ended session, slowness.
  const [running, setRunning] = useState(0);
  const pending = refreshing || running > 0;
  const call = useCallback(
    async <T extends ActionResult & { holiday?: HolidayInfo }>(run: (choice?: HolidayChoice) => Promise<T>, options: { success?: string | false } = {}): Promise<T | null> => {
      setRunning((count) => count + 1);
      try {
        let result = (await guardCall(() => run())) as T;
        if (!result.ok && result.holiday) {
          const choice = await askHoliday(result.holiday);
          if (!choice) return result;
          result = (await guardCall(() => run(choice))) as T;
        }
        if (!result.ok) {
          toast({ tone: "error", title: result.message || "Couldn't do that." });
          return result;
        }
        // D-233 (partial success): some done and some not is a warning, not a green tick.
        const partial = Number((result as { value?: { failed?: number } }).value?.failed ?? 0) > 0;
        // v1.65.0 (D-373): a date change that moved dependent tasks says how many, with Undo.
        const shifted = (result as { value?: { shifted?: { batchId: number; moved: number } } }).value?.shifted;
        if (shifted && shifted.moved > 0)
          toast({
            tone: "success",
            title: `${shifted.moved} dependent ${shifted.moved === 1 ? "task" : "tasks"} moved`,
            action: { label: "Undo", onClick: () => void undoShiftOnce(shifted.batchId, toast, () => startTransition(() => router.refresh())) },
          });
        else if (partial) toast({ tone: "warning", title: result.message || "Some of them couldn't be changed." });
        else if (options.success !== false && (options.success || result.message)) toast({ tone: "success", title: options.success || result.message || "Saved." });
        startTransition(() => router.refresh());
        return result;
      } catch (error) {
        toast({ tone: "error", title: actionErrorMessage(error) ?? UNEXPECTED });
        return null;
      } finally {
        setRunning((count) => count - 1);
      }
    },
    [router, toast],
  );
  return { call, pending };
}

// The round "complete" button of every task row. Completing shows Undo.
export function TaskCheck({ taskId, done, disabled, label, size = "md" }: { taskId: number; done: boolean; disabled?: boolean; label: string; size?: "sm" | "md" }) {
  const { call } = useWorkCall();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? done;
  // v1.62.0 (D-368): the new check animation and celebrations ("pm_foundations").
  const pm = useCelebrationState().enabled;
  const celebrate = useCelebrate();
  const self = useRef<HTMLButtonElement>(null);
  const toggle = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setOptimistic(!shown);
    const result = await call(() => completeAction(taskId), { success: false });
    if (!result?.ok) setOptimistic(null);
    // The toast below ("Completed: …", polite) is the announcement.
    else if (!shown) celebrate(self.current);
    if (result?.ok && !shown)
      toast({
        tone: "success",
        title: `Completed: ${label}`,
        action: { label: "Undo", onClick: () => void call(() => completeAction(taskId), { success: "Reopened." }) },
      });
    setBusy(false);
  };
  const box = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const animate = shown && optimistic !== null;
  return (
    <>
    <button
      ref={self}
      type="button"
      role="checkbox"
      aria-checked={shown}
      aria-label={`${shown ? "Reopen" : "Complete"} ${label}`}
      title={disabled ? "You can't complete this task" : shown ? "Reopen" : "Mark complete"}
      disabled={disabled || busy}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle();
      }}
      data-testid="task-check"
      // D-234 (Fitts): the circle stays small, but the area that takes the
      // click reaches 8px around it (about 36px), like Asana's.
      className={`relative flex ${box} shrink-0 items-center justify-center rounded-full border transition before:absolute before:-inset-2 before:rounded-full before:content-[''] ${
        shown ? `border-success-600 bg-success-600 text-on-solid ${pm ? `pm-check-done ${animate ? "pm-check-anim" : ""}` : animate ? "brand-pop" : ""}` : "border-line-strong text-transparent hover:border-success-600 hover:text-success-600"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {/* v1.42.0 brand: the tick draws itself when the task is completed here (v1.62.0: our own check animation). */}
      {animate ? (
        <svg viewBox="0 0 24 24" className="h-3 w-3" aria-hidden="true" data-testid="task-done-tick">
          <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className={pm ? "pm-check-draw" : "brand-draw-tick"} />
        </svg>
      ) : (
        <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
      )}
    </button>
    </>
  );
}

// v1.61.0 (D-367): a project's colour key maps to a theme identity token
// (light and dark in styles/globals.css), no longer a hex value in code. The
// saved keys stay the same; red and green move off the status hues (orange,
// a calmer green).
export const PROJECT_IDENTITY: Record<string, number> = { blue: 1, purple: 2, pink: 3, red: 4, amber: 5, green: 6, teal: 7, gray: 8 };
export const identityColor = (key: string) => `var(--color-identity-${PROJECT_IDENTITY[key] ?? 8})`;
export const COLOR_HEX: Record<string, string> = Object.fromEntries(Object.keys(PROJECT_IDENTITY).map((key) => [key, identityColor(key)]));
export function ProjectDot({ color, className = "h-2.5 w-2.5" }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 rounded-sm ${className}`} style={{ backgroundColor: COLOR_HEX[color] ?? COLOR_HEX.gray }} />;
}

// The question itself, once per page (mounted in the users layout).
export function HolidayPrompt() {
  const [ask, setAsk] = useState<{ info: HolidayInfo; resolve: (choice: HolidayChoice | null) => void } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const onAsk = (event: Event) => {
      event.preventDefault();
      setAsk((event as CustomEvent).detail);
    };
    window.addEventListener(HOLIDAY_EVENT, onAsk);
    return () => window.removeEventListener(HOLIDAY_EVENT, onAsk);
  }, []);
  useEffect(() => {
    if (ask && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [ask]);
  const answer = (choice: HolidayChoice | null) => {
    ask?.resolve(choice);
    setAsk(null);
    // v1.89.0 (D-420): closes with its exit animation in every browser (top-layer.ts).
    if (dialog.current) void closeTopLayer(dialog.current);
  };
  return (
    <dialog ref={dialog} aria-labelledby="holiday-title" onCancel={() => answer(null)} className="ars-dialog w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-raised p-0 text-ink shadow-overlay" data-testid="holiday-prompt">
      {ask && (
        <div className="space-y-3 p-5">
          <h2 id="holiday-title" className="font-semibold">
            {ask.info.away ? `${ask.info.day}: the person is out of office` : `${ask.info.day} is a holiday`}
          </h2>
          <p className="text-body">
            {ask.info.name}. {ask.info.mode === "BLOCK" ? "Tasks can't be dated on holidays here; choose a working day." : ask.info.away ? "Keep the due date anyway, or move it to the day after they are back?" : `Keep the ${ask.info.field === "due" ? "due" : "start"} date anyway, or move it to a working day?`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-compact" onClick={() => answer({ moveTo: ask.info.suggestion })}>
              Move to {ask.info.suggestion}
            </button>
            {ask.info.mode === "WARN" && (
              <button type="button" className="btn-secondary btn-compact" onClick={() => answer({ holidayOk: true })}>
                Keep {ask.info.day}
              </button>
            )}
            <button type="button" className="btn-secondary btn-compact" onClick={() => answer(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// D-219: Asana's "Mark complete" button for a task's page and panel header.
export function TaskCompleteButton({ taskId, done, disabled, title }: { taskId: number; done: boolean; disabled?: boolean; title: string }) {
  const { call, pending } = useWorkCall();
  const toast = useToast();
  const celebrate = useCelebrate();
  const pm = useCelebrationState().enabled;
  const self = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(done);
  useEffect(() => setShown(done), [done]);
  return (
    <button
      ref={self}
      type="button"
      aria-pressed={shown}
      disabled={disabled || pending}
      title={disabled ? "You can't complete this task" : undefined}
      onClick={() => {
        const next = !shown;
        setShown(next);
        // v1.62.0 (D-368): completing here also offers Undo, like a row's tick.
        void call(() => completeAction(taskId), { success: next && pm ? false : next ? `Completed: ${title}` : "Reopened." }).then((result) => {
          if (!result?.ok) return setShown(!next);
          if (next && pm) {
            celebrate(self.current);
            toast({ tone: "success", title: `Completed: ${title}`, action: { label: "Undo", onClick: () => void call(() => completeAction(taskId), { success: "Reopened." }) } });
          }
        });
      }}
      data-testid="mark-complete"
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-label font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
        shown ? "border-success-600 bg-success-50 text-success-600" : "border-line-strong text-ink hover:border-success-600 hover:text-success-600"
      }`}
    >
      <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} />
      {shown ? "Completed" : "Mark complete"}
    </button>
  );
}

// D-219: a task opens in the pane beside the list.
// v1.83.0 (D-410, owner): every task link is a real link to the task's own
// page, so a middle-click or Ctrl-click opens the full page in a new tab; a
// plain click is turned into the side pane on the current screen by the
// shell (TaskPaneHost). Code that opens a task (Enter on a Board card, a bar
// in Timeline) passes the link through openTaskHref.
export function usePaneLink() {
  return useCallback((id: number) => `/users/tasks/${id}`, []);
}

// D-219 (catalog S-17): copy a task's link.
export function CopyLinkButton({ path, label = "Copy task link" }: { path: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() =>
        void copyText(`${window.location.origin}${path}`).then((done) => toast(done ? { tone: "success", title: "Link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${window.location.origin}${path}` }))
      }
      className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink"
    >
      <Link2 aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}

// D-219: "+ Create task" anywhere in the Tasks area opens the left bar's dialog.
export const CREATE_TASK_EVENT = "ars:create-task";
// v1.59.5 (owner): "Add subtask" opens the same Create task dialog, made under a parent.
// v1.72.0 (D-387): "Milestone" from a view's Add task menu makes the new task a milestone.
// v1.73.0 (D-396): `prefill` fills the window from another task (Create
// follow-up task, Duplicate task in the task's ⋯ menu); the person checks it
// and creates the task as usual (every rule of a new task applies).
export type CreateTaskDetail = { projectId?: number | null; parentId?: number | null; parentLabel?: string; milestone?: boolean; prefill?: { heading: string; title: string; description?: string; priority?: string } };
export function openCreateTask(detail: CreateTaskDetail = {}) {
  window.dispatchEvent(new CustomEvent<CreateTaskDetail>(CREATE_TASK_EVENT, { detail }));
}
export function CreateTaskButton({ label = "Create task" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(CREATE_TASK_EVENT))} className="btn-secondary btn-compact inline-flex items-center gap-1">
      <Plus aria-hidden="true" className="h-4 w-4" /> {label}
    </button>
  );
}

// v1.62.0 (D-368, BR-DEL-001): deleting a task offers Undo (restores it and
// its subtasks), like completing one. Several tasks (the bulk bar) at once too.
export function useDeleteWithUndo() {
  const { call, pending } = useWorkCall();
  const toast = useToast();
  const remove = useCallback(
    async (taskIds: readonly number[], label: string, run?: () => Promise<ActionResult>) => {
      const result = await call(run ?? (() => deleteTaskAction(taskIds[0]!)), { success: false });
      if (!result?.ok) return result;
      toast({
        tone: "success",
        title: label,
        body: "You can also restore it from Deleted for 30 days.",
        action: {
          label: "Undo",
          onClick: async () => {
            for (const id of taskIds) await call(() => deleteTaskAction(id, true), { success: false });
            toast({ tone: "success", title: taskIds.length === 1 ? "Task restored." : `${taskIds.length} tasks restored.` });
          },
        },
      });
      return result;
    },
    [call, toast],
  );
  return { remove, pending };
}
