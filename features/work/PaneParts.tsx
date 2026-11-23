"use client";

import { CopyPlus, CornerDownRight, FolderPlus, Heart, ListPlus, Maximize2, MoreHorizontal, PanelRight, Paperclip, Printer, Tag, Trash2, Link2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { likeAction, paneModeAction, paneWidthAction } from "@/app/users/work/actions";
import type { PaneMode } from "@/server/work/pm-rules";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { openCreateTask, useDeleteWithUndo, useWorkCall } from "@/features/work/client";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { runAutomationOnTaskAction } from "@/app/users/work/automation-actions";
import { clampPaneWidth, PANE_DEFAULT, PANE_MAX, PANE_MIN } from "@/server/work/pm-rules";

// v1.62.0 (D-368, spec CMP-27 / PRJ views §13): the parts of the task pane
// beside a project view: its resize handle (drag, or ← / → on the focused
// handle; the width is kept for the person), the Like button of its action
// bar, and the "More actions" menu.

// v1.83.0 (D-410): the screen beside the pane makes room for it from :root.
const setPaneVar = (width: number) => document.documentElement.style.setProperty("--pane-w", `${width}px`);

// v1.83.0 (D-410, owner): ⤢ in the pane's bar opens the task in the centred
// dialog; the dialog's own button goes back to the side pane. The choice is
// kept for the person (like the width). Wide screens only: below 1024 px the
// side pane already is the centred popup.
export function PaneModeButton({ to }: { to: PaneMode }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const dialog = to === "DIALOG";
  const label = dialog ? "Open in a dialog" : "Back to the side pane";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await paneModeAction(to).catch(() => null);
          if (!result?.ok) {
            toast({ tone: "error", title: result?.message || "Couldn't change that. Please try again." });
            return;
          }
          router.refresh();
        })
      }
      className="hidden h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-60 lg:grid"
      data-testid={dialog ? "pane-expand" : "pane-to-side"}
    >
      {dialog ? <Maximize2 aria-hidden="true" className="h-4 w-4" /> : <PanelRight aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
}

export function PaneResizer({ initial }: { initial: number }) {
  const [width, setWidth] = useState(initial);
  const saved = useRef(initial);
  const [live, setLive] = useState("");
  useEffect(() => setPaneVar(width), [width]);
  const save = (value: number) => {
    if (value === saved.current) return;
    saved.current = value;
    void paneWidthAction(value);
  };
  const apply = (value: number, announce = false) => {
    const next = clampPaneWidth(value);
    setWidth(next);
    if (announce) setLive(`Task pane ${next} pixels wide.`);
    return next;
  };
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the task pane"
        aria-valuemin={PANE_MIN}
        aria-valuemax={PANE_MAX}
        aria-valuenow={width}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End"
        tabIndex={0}
        title="Drag to resize; double-click for the usual width"
        data-testid="pane-resizer"
        className="absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1 cursor-col-resize touch-none hover:bg-primary-600/30 focus-visible:bg-primary-600/40 focus-visible:outline-none lg:block"
        onPointerDown={(event) => {
          event.preventDefault();
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          let last = width;
          const move = (moveEvent: PointerEvent) => {
            last = apply(window.innerWidth - moveEvent.clientX);
          };
          const up = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", up);
            target.removeEventListener("pointercancel", up);
            save(last);
          };
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", up);
          target.addEventListener("pointercancel", up);
        }}
        onDoubleClick={() => save(apply(PANE_DEFAULT, true))}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 16;
          const next =
            event.key === "ArrowLeft" ? width + step : event.key === "ArrowRight" ? width - step : event.key === "Home" ? PANE_MAX : event.key === "End" ? PANE_MIN : event.key === "Enter" ? PANE_DEFAULT : null;
          if (next === null) return;
          event.preventDefault();
          save(apply(next, true));
        }}
      />
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
    </>
  );
}

// "N likes. Like this task" (spec action bar).
export function TaskLikeButton({ taskId, liked, count, names }: { taskId: number; liked: boolean; count: number; names: string[] }) {
  const { call, pending } = useWorkCall();
  const label = `${count} like${count === 1 ? "" : "s"}. ${liked ? "Remove your like" : "Like this task"}`;
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={label}
      title={names.length ? `Liked by ${names.join(", ")}` : "Like this task"}
      disabled={pending}
      onClick={() => void call(() => likeAction("TASK", taskId), { success: false })}
      className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-label ${liked ? "bg-danger-50 text-danger-600" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}
      data-testid="pane-like"
    >
      <Heart aria-hidden="true" className="h-4 w-4" fill={liked ? "currentColor" : "none"} />
      <span aria-hidden="true" className="tabular-nums">
        {count}
      </span>
    </button>
  );
}

// More actions: copy link, open full page, delete (with Undo).
// v1.72.0 (D-387, spec PV §13.3): an ARIA menu in the spec's order with the
// actions ARS has: Add to another project, Add subtask, Add tags, Attach
// files, then Copy task link, Open full page, Print, the project's "by hand"
// automations, then Delete task (asks first, in a small dialog). The menu is
// placed against the window, so the pane's scrolling body never clips it.
// v1.73.0 (D-396, spec PV §13.3): Create follow-up task and Duplicate task
// (after Attach files, as in the spec) open the Create task window filled from
// this task: a follow-up gets "Follow-up: <name>" and a link back in its
// description; a duplicate copies the name, description, priority and project.
// The person checks it and creates it; every rule of a new task applies.
export function PaneMoreMenu({ taskId, title, canDelete, closeHref, automations = [], copy }: { taskId: number; title: string; canDelete: boolean; closeHref: string; automations?: { id: number; name: string; projectName: string }[]; copy?: { projectId: number | null; description: string; priority: string } }) {
  const toast = useToast();
  const router = useRouter();
  const { call } = useWorkCall();
  const { remove, pending } = useDeleteWithUndo();
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirming && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [confirming]);
  const path = `/users/tasks/${taskId}`;
  const pane = () => document.querySelector<HTMLElement>("[data-task-pane]") ?? document.body;
  // Moves to a part of the pane (and opens it when folded), else says where it is.
  const goTo = (selector: string, fallback: string, then?: (element: HTMLElement) => void) =>
    requestAnimationFrame(() => {
      const element = pane().querySelector<HTMLElement>(selector);
      if (!element) {
        toast({ tone: "info", title: fallback });
        return;
      }
      const folded = element.closest("details");
      if (folded && !folded.open) folded.open = true;
      element.scrollIntoView({ block: "center" });
      if (then) then(element);
      else element.focus();
    });
  const items: MenuItem[] = [
    { label: "Add to another project", icon: <FolderPlus className="h-4 w-4" />, onSelect: () => goTo("#add-to-project", "This task can't be added to another project from here."), testId: "pane-add-project" },
    { label: "Add subtask", icon: <ListPlus className="h-4 w-4" />, onSelect: () => goTo('[data-testid="add-subtask"]', "Subtasks can't be added to this task.", (element) => element.click()), testId: "pane-add-subtask" },
    { label: "Add tags", icon: <Tag className="h-4 w-4" />, onSelect: () => goTo("#new-tag", "Tags can't be changed on this task."), testId: "pane-add-tags" },
    { label: "Attach files", icon: <Paperclip className="h-4 w-4" />, onSelect: () => goTo('input[type="file"]:not([aria-hidden="true"])', "Files are added with a comment.", (element) => element.click()), testId: "pane-attach" },
    ...(copy
      ? [
          {
            label: "Create follow-up task",
            icon: <CornerDownRight className="h-4 w-4" />,
            onSelect: () => openCreateTask({ projectId: copy.projectId, prefill: { heading: "Create follow-up task", title: `Follow-up: ${title}`.slice(0, 200), description: `Follow-up of “${title}”: ${window.location.origin}${path}` } }),
            testId: "pane-follow-up",
          },
          {
            label: "Duplicate task",
            icon: <CopyPlus className="h-4 w-4" />,
            onSelect: () => openCreateTask({ projectId: copy.projectId, prefill: { heading: "Duplicate task", title: `${title} (copy)`.slice(0, 200), description: copy.description, priority: copy.priority } }),
            testId: "pane-duplicate",
          },
        ]
      : []),
    { kind: "separator", label: "" },
    {
      label: "Copy task link",
      icon: <Link2 className="h-4 w-4" />,
      onSelect: () => void copyText(`${window.location.origin}${path}`).then((done) => toast(done ? { tone: "success", title: "Link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${window.location.origin}${path}` })),
    },
    { label: "Open full page", icon: <Maximize2 className="h-4 w-4" />, href: path },
    { label: "Print", icon: <Printer className="h-4 w-4" />, onSelect: () => window.print() },
    ...(automations.length
      ? [
          { kind: "separator" as const, label: "" },
          { kind: "heading" as const, label: "Run automation" },
          ...automations.map((rule) => ({ label: `Run “${rule.name}”`, hint: `From ${rule.projectName}`, icon: <Zap className="h-4 w-4 text-warning-600" />, onSelect: () => void call(() => runAutomationOnTaskAction(rule.id, taskId)) })),
        ]
      : []),
    ...(canDelete ? [{ kind: "separator" as const, label: "" }, { label: "Delete task", icon: <Trash2 className="h-4 w-4" />, tone: "danger" as const, onSelect: () => setConfirming(true), testId: "pane-delete" }] : []),
  ];
  return (
    <>
      <Menu label="More actions for this task" title="More actions" trigger={<MoreHorizontal aria-hidden="true" className="h-5 w-5" />} buttonClass="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink" menuClass="w-60" items={items} testId="pane-more" />
      {confirming && (
        <dialog ref={dialog} onClose={() => setConfirming(false)} aria-labelledby="pane-delete-title" className="ars-dialog w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-raised p-0 text-ink shadow-overlay" data-testid="pane-delete-dialog">
          <div className="space-y-3 p-5">
            <h2 id="pane-delete-title" className="font-semibold">
              Delete this task?
            </h2>
            <p className="text-label text-ink-muted">“{title}” and its subtasks go to Deleted. You can undo, or restore it for 30 days.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                className="btn-danger btn-compact"
                onClick={() =>
                  void remove([taskId], `Deleted: ${title}`).then((result) => {
                    dialog.current?.close();
                    if (result?.ok) router.push(closeHref, { scroll: false });
                  })
                }
                data-testid="pane-delete-confirm"
              >
                Yes, delete
              </button>
              <button type="button" className="btn-secondary btn-compact" onClick={() => dialog.current?.close()}>
                Keep it
              </button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
