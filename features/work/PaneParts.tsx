"use client";

import { Heart, Maximize2, MoreHorizontal, Trash2, Link2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { likeAction, paneWidthAction } from "@/app/users/work/actions";
import { inside } from "@/features/ui/inside";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { useDeleteWithUndo, useWorkCall } from "@/features/work/client";
import { RunAutomationButtons } from "@/features/work/automations/RunAutomationButtons";
import { clampPaneWidth, PANE_DEFAULT, PANE_MAX, PANE_MIN } from "@/server/work/pm-rules";

// v1.62.0 (D-368, spec CMP-27 / PRJ views §13): the parts of the task pane
// beside a project view: its resize handle (drag, or ← / → on the focused
// handle; the width is kept for the person), the Like button of its action
// bar, and the "More actions" menu.

const setPaneVar = (width: number) => document.querySelector<HTMLElement>("[data-pane-side]")?.style.setProperty("--pane-w", `${width}px`);

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
export function PaneMoreMenu({ taskId, title, canDelete, closeHref, automations = [] }: { taskId: number; title: string; canDelete: boolean; closeHref: string; automations?: { id: number; name: string; projectName: string }[] }) {
  const box = useRef<HTMLDetailsElement>(null);
  const toast = useToast();
  const router = useRouter();
  const { remove, pending } = useDeleteWithUndo();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current?.open && !inside(event, box.current)) box.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const path = `/users/tasks/${taskId}`;
  return (
    <details ref={box} className="relative" data-testid="pane-more" onToggle={(event) => !(event.currentTarget as HTMLDetailsElement).open && setConfirming(false)}>
      <summary aria-label="More actions for this task" title="More actions" className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
      </summary>
      <div className="absolute right-0 z-popover mt-1 w-56 rounded-lg border border-line bg-raised p-1 text-label shadow-overlay" role="group" aria-label="More actions">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-muted"
          onClick={() => void copyText(`${window.location.origin}${path}`).then((done) => toast(done ? { tone: "success", title: "Link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${window.location.origin}${path}` }))}
        >
          <Link2 aria-hidden="true" className="h-4 w-4" /> Copy task link
        </button>
        <Link href={path} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-muted">
          <Maximize2 aria-hidden="true" className="h-4 w-4" /> Open full page
        </Link>
        <RunAutomationButtons taskId={taskId} rules={automations} compact />
        {canDelete &&
          (confirming ? (
            <div className="space-y-1 rounded bg-danger-50 p-2">
              <p>Delete this task and its subtasks? You can undo, or restore it for 30 days.</p>
              <button
                type="button"
                disabled={pending}
                className="btn-danger btn-compact"
                onClick={() =>
                  void remove([taskId], `Deleted: ${title}`).then((result) => {
                    if (result?.ok) router.push(closeHref, { scroll: false });
                  })
                }
                data-testid="pane-delete-confirm"
              >
                Yes, delete
              </button>
            </div>
          ) : (
            <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-danger-600 hover:bg-danger-50" onClick={() => setConfirming(true)} data-testid="pane-delete">
              <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete task
            </button>
          ))}
      </div>
    </details>
  );
}
