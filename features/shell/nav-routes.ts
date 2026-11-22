// v1.72.1 (D-395, QA review of state screens and navigation): small, pure
// routing rules shared by the menus and the redirect-only pages, so each one
// is tested once (tests/ui/nav-routes-v1721.test.ts). No access is decided
// here: callers pass what the person may open, and every page checks again.

// One "Project templates" destination: the gallery (/users/work/templates)
// when the "pm_extras" switch is on, else the Templates tab of Projects.
export function projectTemplatesHref(galleryOn: boolean): string {
  return galleryOn ? "/users/work/templates" : "/users/work/projects?show=templates";
}

// /users/approvals?tab=… on a computer: the matching full list, if the person
// may open it; otherwise the first list they can open; Home as a last resort.
export type ApprovalsTab = "waiting" | "mine" | "approved" | "drafts";
export function approvalsDesktopHref(tab: string | undefined, can: { queue: boolean; mine: boolean; approved: boolean }): string {
  const wanted: Record<ApprovalsTab, { href: string; ok: boolean }> = {
    waiting: { href: "/users/queue", ok: can.queue },
    mine: { href: "/users/requests", ok: can.mine },
    approved: { href: "/users/approved", ok: can.approved },
    // Drafts live on Home on a computer (Your drafts).
    drafts: { href: "/users?drafts=all", ok: can.mine },
  };
  const asked = tab && tab in wanted ? wanted[tab as ApprovalsTab] : null;
  if (asked?.ok) return asked.href;
  if (can.queue) return "/users/queue";
  if (can.mine) return "/users/requests";
  return "/users";
}

// The phone hub's tab: the one asked for if the person may see it, else the first they can.
export function approvalsPhoneTab(tab: string | undefined, can: { queue: boolean; mine: boolean }): ApprovalsTab {
  const allowed: ApprovalsTab[] = [...(can.queue ? (["waiting"] as const) : []), ...(can.mine ? (["mine", "approved", "drafts"] as const) : [])];
  if (tab && (allowed as string[]).includes(tab)) return tab as ApprovalsTab;
  return allowed[0] ?? "mine";
}

// Old Task home links (/users/work?task=N) open the task itself.
export function legacyTaskHref(task: unknown): string | null {
  return typeof task === "string" && /^[1-9]\d{0,9}$/.test(task) ? `/users/tasks/${task}` : null;
}

// A menu entry with a query (e.g. ?show=templates) is lit only when the
// address has the same path and every one of its values.
export function queryHrefMatches(href: string, pathname: string, search: { get(key: string): string | null } | null): boolean {
  const [path, query] = href.split("?");
  if (!query || path !== pathname || !search) return false;
  return [...new URLSearchParams(query)].every(([key, value]) => search.get(key) === value);
}

// Lists that load "the latest N" rows: ?limit= asks for more, in steps, up to a ceiling.
export function latestLimit(raw: unknown, base: number, max: number): number {
  const asked = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : base;
  return Math.min(max, Math.max(base, Math.ceil(asked / base) * base));
}
