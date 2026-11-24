import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { CopyLinkButton } from "@/features/work/client";
import { TaskDetail } from "@/features/work/TaskDetail";
import { LiveRefresh } from "@/features/work/useLiveRefresh";
import { PaneModeButton, PaneResizer } from "@/features/work/PaneParts";
import { PaneFocus } from "@/features/work/TaskPaneHost";
import { PaneControl } from "@/features/ui/PaneControl";
import type { PaneMode } from "@/server/work/pm-rules";
import type { AuthenticatedUser } from "@/types/auth";
export { visibilityText } from "@/features/work/visibility";

// D-219: a task opens from the screen it was clicked on (?task=<id>).
// v1.52.1 (owner: "when opening a task it should open in a popup window with
// all the actions"): the popup has everything its full page has (TaskDetail).
// v1.62.0 (D-368, spec CMP-27): the pane on the right, beside a project view.
// v1.83.0 (D-410, owner: "i want all tasks to be opened like this instead of
// full page; if they want they can open it in a separate dialog box, and if
// needed a new page"): the pane is drawn once by the signed-in shell (the
// @pane slot) for every screen, not only project views, and not only with
// "pm_foundations". Its ⤢ switches to the centred dialog, which has a way
// back; the choice is kept for the person (work.pane_mode, like the width).
// Below 1024 px the side pane is the centred popup; on a phone, full screen.
// Someone who can't see the task gets "not found" (TaskDetail).
export async function TaskPane({ taskId, user, closeHref, mode, width }: { taskId: number; user: AuthenticatedUser; closeHref: string; mode: PaneMode; width: number }) {
  if (mode === "SIDE")
    return (
      <div role="dialog" aria-label="Task details" data-task-pane data-task-id={taskId} data-close-href={closeHref} data-pane-mode="side" data-testid="task-pane" className="fixed inset-0 z-drawer flex items-center justify-center p-0 sm:p-6 lg:inset-auto lg:bottom-0 lg:right-0 lg:top-topbar lg:z-sticky lg:block lg:w-pane lg:p-0">
        {/* The screen beside the pane makes room for it (globals.css, --pane-w). */}
        <style>{`:root{--pane-w:${width}px}`}</style>
        <LiveRefresh />
        <PaneFocus key={taskId} taskId={taskId} />
        <PaneControl />
        <Link href={closeHref} scroll={false} aria-label="Close task" tabIndex={-1} data-pane-close className="fixed inset-0 cursor-default bg-overlay lg:hidden" />
        <div tabIndex={-1} data-pane-focus className="relative h-full w-full max-w-6xl overflow-y-auto overscroll-contain bg-page shadow-2xl focus:outline-none sm:h-auto sm:max-h-full sm:rounded-xl lg:h-full lg:max-h-none lg:max-w-none lg:rounded-none lg:border-l lg:border-line lg:shadow-overlay" data-testid="task-pane-body">
          <PaneResizer initial={width} />
          <div className="p-4 sm:p-5">
            {/* v1.89.0 stage 4 (D-426, v162 root cause): no Suspense boundary around the details.
                D-424 (PERF-02) streamed them behind the pane frame; with that boundary a refresh
                after an action in the pane (useWorkCall: router.refresh in a transition) never
                committed: the server had the change, the pane kept the old state and its buttons
                stayed busy (Undo left "Mark complete" pressed, a removed reaction stayed). The
                layout jump PERF-02 fixed is held by PaneReserve (the pane's room is made before
                the screen is drawn): the PERF-02 guard and the sweep's CLS stay at 0. */}
            <TaskDetail taskId={taskId} user={user} query={{}} popup={{ closeHref, side: true }} />
          </div>
        </div>
      </div>
    );
  return (
    <div role="dialog" aria-modal="true" aria-label="Task" data-task-pane data-task-id={taskId} data-close-href={closeHref} data-pane-mode="dialog" data-testid="task-pane" className="fixed inset-0 z-drawer flex items-center justify-center p-0 sm:p-6">
      {/* v1.61.0 (D-366): the open task stays fresh (15 s, focus, after changes). */}
      <LiveRefresh />
      <PaneFocus key={taskId} taskId={taskId} />
        <PaneControl />
      {/* The dimmed page behind: a click on it closes the popup. */}
      <Link href={closeHref} scroll={false} aria-label="Close task" tabIndex={-1} data-pane-close className="fixed inset-0 cursor-default bg-overlay" />
      <div tabIndex={-1} data-pane-focus className="relative h-full w-full max-w-6xl overflow-y-auto overscroll-contain rounded-none bg-page shadow-2xl focus:outline-none sm:h-auto sm:max-h-full sm:rounded-xl">
        <div className="sticky top-0 z-10 flex items-center justify-end gap-1 rounded-t-xl border-b border-line bg-surface px-3 py-2">
          <PaneModeButton to="SIDE" />
          <CopyLinkButton path={`/users/tasks/${taskId}`} />
          <Link href={`/users/tasks/${taskId}`} data-full-page className="inline-flex items-center gap-1 rounded px-2 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="pane-full">
            <ExternalLink aria-hidden="true" className="h-4 w-4" /> Open full page
          </Link>
          <Link href={closeHref} scroll={false} aria-label="Close task" aria-keyshortcuts="Escape" data-pane-close className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink" data-testid="close-pane">
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

// ?task=<id> from the page's search parameters (null when absent or odd).
export function paneTaskId(raw: string | string[] | undefined): number | null {
  return typeof raw === "string" && /^\d{1,10}$/.test(raw) ? Number(raw) : null;
}

// v1.83.0 (D-410): shared with the client (features/work/pane-open.ts).
export { paneCloseHref, taskHref } from "@/features/work/pane-open";
