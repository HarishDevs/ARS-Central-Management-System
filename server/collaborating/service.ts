import "server-only";
import { hasModule } from "@/server/modules/modules";
import { featureOn } from "@/server/settings/features";
import { pageHiddenByRule } from "@/server/authorization/page-access";
import { baseTotal } from "@/lib/db/repositories/request-lists.repository";
import { countCollabTasks, countCollabTickets } from "@/lib/db/repositories/collaborating.repository";
import { allowedCollabTabs, type CollabTab } from "@/server/collaborating/tabs";
import type { ModuleCode } from "@/types/auth";

type Person = { id: number; roles: readonly string[]; modules: readonly ModuleCode[] };

// v1.91.0 (D-433, D-434): the Collaborating tabs this person may have now and
// their counts, worked out on the server from their modules, the Super Admin's
// switches and page access, and their active collaborations. A module that
// isn't running, or whose record page is Hidden for the person, is never
// counted (its query does not run).
export async function collabAccess(person: Person): Promise<{ tabs: CollabTab[]; counts: Partial<Record<CollabTab, number>> }> {
  const approvalModule = hasModule(person, "APPROVAL");
  const taskModule = hasModule(person, "TASK");
  const ticketModule = hasModule(person, "TICKET");
  const [requestHidden, tasksSwitch, taskHidden, ticketHidden] = await Promise.all([
    pageHiddenByRule(person, "users.request"),
    featureOn("tasks", person).catch(() => false),
    pageHiddenByRule(person, "users.task"),
    pageHiddenByRule(person, "users.ticket_item"),
  ]);
  const [approvalItems, taskItems, ticketItems] = await Promise.all([
    !requestHidden ? baseTotal("COLLAB", person.id) : Promise.resolve(0),
    tasksSwitch && !taskHidden ? countCollabTasks(person.id) : Promise.resolve(0),
    // v1.92.0 (D-441): tickets (no switch: Ticketing is a module only).
    !ticketHidden ? countCollabTickets(person.id) : Promise.resolve(0),
  ]);
  const tabs = allowedCollabTabs({ approvalModule, requestPageOpen: !requestHidden, approvalItems, taskModule, tasksSwitch, taskPageOpen: !taskHidden, taskItems, ticketModule, ticketPageOpen: !ticketHidden, ticketItems });
  const counts: Partial<Record<CollabTab, number>> = {};
  if (tabs.includes("approvals")) counts.approvals = approvalItems;
  if (tabs.includes("tasks")) counts.tasks = taskItems;
  if (tabs.includes("tickets")) counts.tickets = ticketItems;
  return { tabs, counts };
}

// For the sidebar (every page): does the person have any Collaborating tab?
// With a module that has collaborators, yes without counting; otherwise only
// when they collaborate on something.
export async function hasCollabTabs(person: Person): Promise<boolean> {
  const approvalModule = hasModule(person, "APPROVAL");
  const taskModule = hasModule(person, "TASK");
  const ticketModule = hasModule(person, "TICKET");
  const [requestHidden, tasksSwitch, taskHidden, ticketHidden] = await Promise.all([
    pageHiddenByRule(person, "users.request"),
    taskModule ? featureOn("tasks", person).catch(() => false) : Promise.resolve(false),
    pageHiddenByRule(person, "users.task"),
    ticketModule ? pageHiddenByRule(person, "users.ticket_item") : Promise.resolve(true),
  ]);
  if (approvalModule && !requestHidden) return true;
  if (taskModule && tasksSwitch && !taskHidden) return true;
  if (ticketModule && !ticketHidden) return true;
  return (await collabAccess(person)).tabs.length > 0;
}
