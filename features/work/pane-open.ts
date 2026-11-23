// v1.83.0 (D-410, owner: "i want all tasks to be opened like this instead of
// full page"): every task link in the signed-in app is a real link to the
// task's own page (/users/tasks/<id>), so a middle-click or Ctrl-click opens
// the full page in a new tab. A plain click is turned into ?task=<id> on the
// current address by the shell (TaskPaneHost), and the shell's @pane slot
// draws the task beside the screen. These helpers are shared by the host, the
// command palette and anything that opens a task from code.

// Set on <html> while the shell turns task links into the pane (desktop layout, Tasks on).
export const PANE_HOST_ATTR = "data-task-pane-host";

const TASK_PATH = /^\/users\/tasks\/(\d{1,10})\/?$/;

// The task a link points to (its own page, same site), else null.
export function taskIdFromHref(href: string, origin = typeof window === "undefined" ? "https://app.invalid" : window.location.origin): number | null {
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return null;
    const match = TASK_PATH.exec(url.pathname);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// The current address with ?task=<id> (the rest of the address kept).
export function paneHref(id: number, where: { pathname: string; search: string }): string {
  const query = new URLSearchParams(where.search);
  query.set("task", String(id));
  return `${where.pathname}?${query}`;
}

export function paneHostOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(PANE_HOST_ATTR);
}

// For code that navigates (the palette, Create task): a task's page becomes
// the pane on the current screen when the shell offers it.
export function openTaskHref(href: string): string {
  if (!paneHostOn()) return href;
  const id = taskIdFromHref(href);
  if (id === null || window.location.pathname === `/users/tasks/${id}`) return href;
  return paneHref(id, window.location);
}

// A task link is always its own page; a plain click opens it in the shell's
// pane (TaskPaneHost), a middle-click the full page in a new tab.
export const taskHref = (id: number) => `/users/tasks/${id}`;

// Where × goes: the same address without ?task.
export function paneCloseHref(path: string, params: Record<string, string | string[] | undefined>) {
  const keep = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "task") continue;
    for (const item of typeof value === "string" ? [value] : (value ?? [])) keep.append(key, item);
  }
  const query = keep.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

// Where focus goes back to when the pane closes: the link that opened it.
let opener: HTMLElement | null = null;
export function rememberOpener(element: HTMLElement | null) {
  opener = element;
}
export function takeOpener(): HTMLElement | null {
  const element = opener;
  opener = null;
  return element;
}
