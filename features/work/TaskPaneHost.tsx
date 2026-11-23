"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { paneHref, PANE_HOST_ATTR, rememberOpener, takeOpener, taskIdFromHref } from "@/features/work/pane-open";

// v1.83.0 (D-410, owner): every task opens in the side pane beside the
// current screen. Mounted once in the signed-in shell (desktop layout, Tasks
// on). A plain left click on any link to a task's own page (/users/tasks/<id>)
// becomes ?task=<id> on the current address; the shell's @pane slot draws the
// task. Middle-click, Ctrl/⌘/Shift/Alt-click, target=_blank and downloads keep
// the browser's own behaviour, so the full page still opens in a new tab.
// Inside the pane, a link to the open task itself ("Open full page", ⋯ →
// Open full page) and links marked data-full-page go to the full page.
export function TaskPaneHost() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute(PANE_HOST_ATTR, "");
    // Capture, so it runs before Next's <Link> (which then sees defaultPrevented
    // and leaves the navigation to us; its own onClick still runs).
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download") || anchor.hasAttribute("data-full-page")) return;
      // A button or field inside the link (a row's tick) handles its own click.
      const control = target?.closest("button, input, select, textarea, label, [role=checkbox], [role=button]");
      if (control && control !== anchor && anchor.contains(control)) return;
      const id = taskIdFromHref(anchor.getAttribute("href") ?? "");
      if (id === null) return;
      if (window.location.pathname === `/users/tasks/${id}`) return;
      const pane = anchor.closest<HTMLElement>("[data-task-pane]");
      if (pane && pane.dataset.taskId === String(id)) return;
      event.preventDefault();
      // v1.87.0 (D-417): a second click on the same task (double click) adds nothing.
      if (new URLSearchParams(window.location.search).get("task") === String(id)) return;
      if (!pane) rememberOpener(anchor);
      routerRef.current.push(paneHref(id, window.location), { scroll: false });
    };
    // v1.87.0 (D-417): Escape is the overlay stack's (PaneControl in the
    // pane): it reaches the pane only when nothing is open above it.
    document.addEventListener("click", onClick, true);
    return () => {
      root.removeAttribute(PANE_HOST_ATTR);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}

// Inside the pane: focus moves into it when it opens (or shows another task),
// and back to the row that opened it when it closes.
export function PaneFocus({ taskId }: { taskId: number }) {
  const self = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const pane = self.current?.closest<HTMLElement>("[data-task-pane]");
    if (pane && !pane.contains(document.activeElement)) (pane.querySelector<HTMLElement>("[data-pane-focus]") ?? pane).focus({ preventScroll: true });
    return () => {
      // Only when focus was in the pane (or nowhere): the person may have moved on.
      const active = document.activeElement;
      if (active && active !== document.body && !(pane && pane.contains(active)) && active.isConnected) return;
      requestAnimationFrame(() => {
        if (document.querySelector("[data-task-pane]")) return; // another task or the other mode took over
        const opener = takeOpener();
        const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>(`#main a[href="/users/tasks/${taskId}"]`);
        back?.focus({ preventScroll: false });
      });
    };
  }, [taskId]);
  return <span ref={self} hidden />;
}
