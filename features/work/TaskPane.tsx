import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { CopyLinkButton } from "@/features/work/client";
import { TaskDetail } from "@/features/work/TaskDetail";
import { LiveRefresh } from "@/features/work/useLiveRefresh";
import { PaneResizer } from "@/features/work/PaneParts";
import type { AuthenticatedUser } from "@/types/auth";
export { visibilityText } from "@/features/work/visibility";

// D-219: a task opens from the list it was clicked in (?task=<id>).
// v1.52.1 (owner: "when opening a task it should open in a popup window with
// all the actions"): it opens in a popup over the list with everything its
// full page has (TaskDetail): actions, completion, reassign, edit, subtasks,
// comments and activity. Esc, × or a click outside closes it; Open full page
// opens the task's own page. Someone who can't see the task gets "not found".
export async function TaskPane({ taskId, user, closeHref, side }: { taskId: number; user: AuthenticatedUser; closeHref: string; side?: { width: number } | null }) {
  // v1.62.0 (D-368, spec CMP-27, "pm_foundations"): in a project view on a
  // wide screen (1024 px and up) the task opens in a pane on the right, beside
  // the view (its width is the person's, resizable 380–720 px). Narrower
  // screens keep the centred popup; phones the full screen. The pane's own
  // action bar (Mark complete, collaborators, like, copy link, full page,
  // more, close) and the visibility banner come from TaskDetail.
  if (side)
    return (
      <div role="dialog" aria-label="Task details" data-task-pane data-close-href={closeHref} data-pane-mode="side" data-testid="task-pane" className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-6 lg:inset-auto lg:bottom-0 lg:right-0 lg:top-topbar lg:z-sticky lg:block lg:w-pane lg:p-0">
        <LiveRefresh />
        <Link href={closeHref} scroll={false} aria-label="Close task" tabIndex={-1} className="fixed inset-0 cursor-default bg-black/40 lg:hidden" />
        <div className="relative h-full w-full max-w-6xl overflow-y-auto overscroll-contain bg-page shadow-2xl sm:h-auto sm:max-h-full sm:rounded-xl lg:h-full lg:max-h-none lg:max-w-none lg:rounded-none lg:border-l lg:border-line lg:shadow-overlay" data-testid="task-pane-body">
          <PaneResizer initial={side.width} />
          <div className="p-4 sm:p-5">
            <TaskDetail taskId={taskId} user={user} query={{}} popup={{ closeHref, side: true }} />
          </div>
        </div>
      </div>
    );
  return (
    <div role="dialog" aria-modal="true" aria-label="Task" data-task-pane data-close-href={closeHref} data-testid="task-pane" className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-6">
      {/* v1.61.0 (D-366): the open task stays fresh (15 s, focus, after changes). */}
      <LiveRefresh />
      {/* The dimmed page behind: a click on it closes the popup. */}
      <Link href={closeHref} scroll={false} aria-label="Close task" tabIndex={-1} className="fixed inset-0 cursor-default bg-black/40" />
      <div className="relative h-full w-full max-w-6xl overflow-y-auto overscroll-contain rounded-none bg-page shadow-2xl sm:h-auto sm:max-h-full sm:rounded-xl">
        <div className="sticky top-0 z-10 flex items-center justify-end gap-1 rounded-t-xl border-b border-line bg-surface px-3 py-2">
          <CopyLinkButton path={`/users/tasks/${taskId}`} />
          <Link href={`/users/tasks/${taskId}`} className="inline-flex items-center gap-1 rounded px-2 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink">
            <ExternalLink aria-hidden="true" className="h-4 w-4" /> Open full page
          </Link>
          <Link href={closeHref} scroll={false} aria-label="Close task" aria-keyshortcuts="Escape" className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="close-pane">
            <X aria-hidden="true" className="h-5 w-5" />
          </Link>
        </div>
        <div className="p-4 sm:p-6">
          <TaskDetail taskId={taskId} user={user} query={{}} popup={{ closeHref }} />
        </div>
      </div>
    </div>
  );
}

// The page with its list on the left and the task pane on the right.
// v1.62.0 (D-368): with the side pane, the view makes room for it on wide
// screens (--pane-w, the person's width; the resize handle updates it live).
export function WithPane({ pane, children, sideWidth }: { pane: React.ReactNode | null; children: React.ReactNode; sideWidth?: number | null }) {
  if (!pane) return <>{children}</>;
  if (sideWidth)
    return (
      <div data-pane-side style={{ "--pane-w": `${sideWidth}px` } as React.CSSProperties}>
        <div className="pm-with-pane">{children}</div>
        {pane}
      </div>
    );
  // v1.52.1: the task is a popup over the list, so the list keeps its full width.
  return (
    <>
      {children}
      {pane}
    </>
  );
}

// ?task=<id> from the page's search parameters (null when absent or odd).
export function paneTaskId(raw: string | string[] | undefined): number | null {
  return typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : null;
}

// Addresses for a server-drawn page: open a task in the pane, close the pane.
export function paneLinks(path: string, params: Record<string, string | string[] | undefined>) {
  const keep = Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "task"));
  const close = new URLSearchParams(keep).toString();
  return {
    open: (id: number) => `${path}?${new URLSearchParams({ ...keep, task: String(id) })}`,
    close: `${path}${close ? `?${close}` : ""}`,
  };
}


