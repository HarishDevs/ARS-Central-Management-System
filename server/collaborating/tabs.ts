// v1.91.0 (D-433, owner, 26 Nov 2026: "Separate the collaborators screen from
// approvals and make it common for all like we have for calendar and
// analytics ... tasks, approvals, tickets as tabs"). Pure and unit-tested.
//
// A tab exists only for a module that has a real "added as a collaborator"
// relationship in the data (investigated for v1.91.0, see DEVELOPMENT-MEMORY
// D-433): Approvals (request_collaborators) and Tasks (task_followers, shown
// as "Collaborators" on a task). Tickets, meetings, information and projects
// have none (a ticket is seen by its requester, assignee and coordinators;
// meetings have invitees; information has recipients; projects have members
// with roles), so they get no tab until such a relationship exists (Q-036).
//
// Access (owner's follow-ups, 26 Nov 2026, D-434): "if I am not having any
// access for the approvals module, if I am added as a collaborator I should be
// able to open and access that approval" and "in this case I am a commenter.
// If I have the module access then I have my same privileges." So a tab shows
// when the person has the module, OR when they are an active collaborator on
// at least one item of it (they then open those items as a Commenter). Either
// way the module must be running (the Super Admin's switch, where the module
// has one) and its record page not Hidden for them (page access). A module
// switched off for everyone shows nothing.
export const COLLAB_TABS = ["approvals", "tasks"] as const;
export type CollabTab = (typeof COLLAB_TABS)[number];

export const COLLAB_TAB_LABEL: Record<CollabTab, string> = { approvals: "Approvals", tasks: "Tasks" };

export const COLLAB_EMPTY: Record<CollabTab, string> = {
  approvals: "Nobody has added you to a request yet. When they do, it appears here.",
  tasks: "Nobody has added you to a task yet. When someone adds you as a collaborator on their task, it appears here.",
};

export const COLLAB_PAGE_SIZE = 25;

export const COLLAB_TASK_SORTS = ["task", "assignee", "status", "due", "updated", "added"] as const;
export type CollabTaskSort = (typeof COLLAB_TASK_SORTS)[number];

export interface CollabAccessFacts {
  approvalModule: boolean; // hasModule(APPROVAL)
  requestPageOpen: boolean; // page access: users.request not Hidden by a rule
  approvalItems: number; // active collaborations on requests (counted only when needed)
  taskModule: boolean; // hasModule(TASK)
  tasksSwitch: boolean; // features.tasks (the module is running)
  taskPageOpen: boolean; // page access: users.task not Hidden by a rule
  taskItems: number; // active collaborations on tasks
}

// The tabs this person may have, in the screen's order.
export function allowedCollabTabs(facts: CollabAccessFacts): CollabTab[] {
  const tabs: CollabTab[] = [];
  if (facts.requestPageOpen && (facts.approvalModule || facts.approvalItems > 0)) tabs.push("approvals");
  if (facts.tasksSwitch && facts.taskPageOpen && (facts.taskModule || facts.taskItems > 0)) tabs.push("tasks");
  return tabs;
}

const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const isCollabTab = (value: unknown): value is CollabTab => typeof value === "string" && (COLLAB_TABS as readonly string[]).includes(value);

// Which tab the address opens. `?tab=` names a module tab (tasks; approvals);
// any other ?tab value is the Approvals list's own quick tab (open, approved,
// overdue…, kept from before v1.91.0, so bookmarks and saved views still
// open the request list). Rules:
//  1. ?tab=<a module tab the person has> → that tab;
//  2. ?tab=<a module tab the person does NOT have> → the first allowed tab
//     (nothing of the forced module is read);
//  3. any other address with filters (a request quick tab, q, sort, a saved
//     view) → Approvals when the person has it;
//  4. a bare address → the first allowed tab with items, else the first allowed tab.
// null: the person has no tab at all (the page is then not found).
export function pickCollabTab(query: Record<string, unknown>, allowed: readonly CollabTab[], counts: Partial<Record<CollabTab, number>>): CollabTab | null {
  if (allowed.length === 0) return null;
  const asked = one(query.tab);
  if (isCollabTab(asked)) return allowed.includes(asked) ? asked : allowed[0]!;
  const filtered = Object.entries(query).some(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0));
  if (filtered && allowed.includes("approvals")) return "approvals";
  return allowed.find((tab) => (counts[tab] ?? 0) > 0) ?? allowed[0]!;
}

// The address of a tab (its own query only).
export function collabTabHref(tab: CollabTab, extra: Record<string, string | number | null | undefined> = {}): string {
  const query = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  return `/users/collaborating?${query.toString()}`;
}
