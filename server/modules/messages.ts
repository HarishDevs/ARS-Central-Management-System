import "server-only";
import type { NotifyInput } from "@/server/notifications/notify";
import { indiaDateTimeText } from "@/server/modules/settings";
import { appBaseUrl } from "@/lib/http/app-url";

// v1.9.0: the messages of the Task and Information modules. In-app always;
// email too (plain text, D-091); WhatsApp only when IT has switched on a
// template for the event (same rule as every other message).
const base = () => appBaseUrl();

function message(eventType: string, userId: number, title: string, text: string, path: string, entity: NotifyInput["entity"]): NotifyInput {
  const link = `${base()}${path}`;
  return {
    eventType,
    userId,
    title: title.slice(0, 200),
    message: text.slice(0, 1000),
    deepLink: link,
    entity,
    email: { subject: title.slice(0, 180), text: `${text}\n\nOpen it: ${link}\n\nSign in to see the details. This message can't be answered.` },
    whatsappVariables: { title: title.slice(0, 120), link },
  };
}

export interface TaskInfo {
  id: number;
  taskNo: string;
  title: string;
  dueAt?: Date | null;
}

const taskPath = (task: TaskInfo) => `/users/tasks/${task.id}`;
const due = (task: TaskInfo) => (task.dueAt ? ` Due ${indiaDateTimeText(task.dueAt)}.` : "");

export const taskMessages = {
  assigned: (task: TaskInfo, to: number, by: string) => message("WORK_TASK_ASSIGNED", to, `Task for you: ${task.taskNo} ${task.title}`, `${by} assigned you the task "${task.title}" (${task.taskNo}).${due(task)}`, taskPath(task), { type: "TASK", id: task.id }),
  updated: (task: TaskInfo, to: number, what: string) => message("WORK_TASK_UPDATED", to, `Task ${task.taskNo}: ${what}`, `"${task.title}" (${task.taskNo}): ${what}.`, taskPath(task), { type: "TASK", id: task.id }),
  comment: (task: TaskInfo, to: number, by: string) => message("WORK_TASK_COMMENT", to, `New comment on task ${task.taskNo}`, `${by} commented on "${task.title}" (${task.taskNo}).`, taskPath(task), { type: "TASK", id: task.id }),
  completed: (task: TaskInfo, to: number, by: string) => message("WORK_TASK_COMPLETED", to, `Task completed: ${task.taskNo}`, `${by} completed "${task.title}" (${task.taskNo}).`, taskPath(task), { type: "TASK", id: task.id }),
  reopened: (task: TaskInfo, to: number, by: string) => message("WORK_TASK_REOPENED", to, `Task reopened: ${task.taskNo}`, `${by} reopened "${task.title}" (${task.taskNo}).`, taskPath(task), { type: "TASK", id: task.id }),
  cancelled: (task: TaskInfo, to: number, by: string) => message("WORK_TASK_CANCELLED", to, `Task cancelled: ${task.taskNo}`, `${by} cancelled "${task.title}" (${task.taskNo}).`, taskPath(task), { type: "TASK", id: task.id }),
  dueSoon: (task: TaskInfo, to: number) => message("WORK_TASK_DUE_SOON", to, `Task due soon: ${task.taskNo}`, `"${task.title}" (${task.taskNo}) is due soon.${due(task)}`, taskPath(task), { type: "TASK", id: task.id }),
  overdue: (task: TaskInfo, to: number) => message("WORK_TASK_OVERDUE", to, `Task overdue: ${task.taskNo}`, `"${task.title}" (${task.taskNo}) is overdue.${due(task)}`, taskPath(task), { type: "TASK", id: task.id }),
  // D-215: Task & Project Management.
  mentioned: (task: TaskInfo, to: number, by: string) => message("WORK_TASK_MENTION", to, `${by} mentioned you on ${task.taskNo}`, `${by} mentioned you in a comment on "${task.title}" (${task.taskNo}).`, taskPath(task), { type: "TASK", id: task.id }),
  followed: (task: TaskInfo, to: number, by: string) => message("WORK_TASK_UPDATED", to, `You now follow task ${task.taskNo}`, `${by} added you as a follower of "${task.title}" (${task.taskNo}).`, taskPath(task), { type: "TASK", id: task.id }),
  unblocked: (task: TaskInfo, to: number) => message("WORK_TASK_UPDATED", to, `Ready to start: ${task.taskNo}`, `Everything blocking "${task.title}" (${task.taskNo}) is now complete.`, taskPath(task), { type: "TASK", id: task.id }),
};

export interface ProjectInfo {
  id: number;
  name: string;
}
const projectPath = (project: ProjectInfo) => `/users/work/projects/${project.id}`;
export const projectMessages = {
  added: (project: ProjectInfo, to: number, by: string, role: string) => message("WORK_PROJECT_MEMBER", to, `Added to project: ${project.name}`, `${by} added you to the project "${project.name}" as ${role.toLowerCase()}.`, projectPath(project), null),
  status: (project: ProjectInfo, to: number, by: string, status: string, title: string) =>
    message("WORK_PROJECT_STATUS", to, `${project.name}: ${status}`, `${by} posted a status update on "${project.name}": ${status}. ${title}`, `${projectPath(project)}?view=overview`, null),
};

export interface InfoSummary {
  id: number;
  infoNo: string;
  title: string;
  ackRequired: boolean;
}

const infoPath = (info: InfoSummary) => `/users/information/${info.id}`;

export const infoMessages = {
  published: (info: InfoSummary, to: number, by: string) =>
    message("INFO_PUBLISHED", to, `${info.ackRequired ? "Please read and acknowledge" : "For your information"}: ${info.title}`, `${by} sent you "${info.title}" (${info.infoNo}).${info.ackRequired ? " Please open it and press Acknowledge." : ""}`, infoPath(info), { type: "INFO", id: info.id }),
  updated: (info: InfoSummary, to: number, by: string) => message("INFO_UPDATED", to, `Updated: ${info.title}`, `${by} updated "${info.title}" (${info.infoNo}).`, infoPath(info), { type: "INFO", id: info.id }),
  withdrawn: (info: InfoSummary, to: number, by: string) => message("INFO_WITHDRAWN", to, `Withdrawn: ${info.title}`, `${by} withdrew "${info.title}" (${info.infoNo}). You don't need to act on it.`, infoPath(info), { type: "INFO", id: info.id }),
  ackReminder: (info: InfoSummary, to: number) => message("INFO_ACK_REMINDER", to, `Reminder: please acknowledge ${info.title}`, `You haven't acknowledged "${info.title}" (${info.infoNo}) yet.`, infoPath(info), { type: "INFO", id: info.id }),
};

// v1.51.0 (D-300): Meeting Management. Everything the Coordinator enters
// reaches the participants; approvals reach the Meeting Owner.
export interface MeetingInfo {
  id: number;
  meetingNo: string;
  title: string;
  start?: Date | null;
  // v1.55.2 (D-330, owner: "enable all meeting notifications for scheduling a
  // meeting"): the invitation and change messages carry the full details.
  end?: Date | null;
  mode?: string | null;
  venue?: string | null;
  link?: string | null;
}
export type MeetingRole = "OWNER" | "COORDINATOR" | "PARTICIPANT";
const meetingPath = (meeting: MeetingInfo) => `/users/meetings/${meeting.id}`;
const MODE_TEXT: Record<string, string> = { OFFLINE: "In person", ONLINE: "Online", HYBRID: "Hybrid" };
const endClock = (end: Date) => end.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
const when = (meeting: MeetingInfo) => {
  if (!meeting.start) return "";
  const parts = [` On ${indiaDateTimeText(meeting.start)}${meeting.end ? ` to ${endClock(meeting.end)}` : ""}.`];
  if (meeting.mode) parts.push(` ${MODE_TEXT[meeting.mode] ?? meeting.mode}${meeting.venue ? `, ${meeting.venue}` : ""}.`);
  else if (meeting.venue) parts.push(` Venue: ${meeting.venue}.`);
  if (meeting.link) parts.push(` Join: ${meeting.link}`);
  return parts.join("");
};
const ROLE_TEXT: Record<MeetingRole, string> = {
  OWNER: " You are the Meeting Owner: you approve the meeting points and the MOM.",
  COORDINATOR: " You are the Coordinator: you send the points, mark attendance and write the MOM.",
  PARTICIPANT: "",
};
export const meetingMessages = {
  invited: (meeting: MeetingInfo, to: number, by: string, role: MeetingRole = "PARTICIPANT") =>
    message("MEETING_INVITED", to, `Meeting: ${meeting.title}`, `${by} added you to the meeting "${meeting.title}" (${meeting.meetingNo}).${when(meeting)}${ROLE_TEXT[role]}`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  // The person who scheduled it gets a copy (they're never sent their own invitation).
  scheduled: (meeting: MeetingInfo, to: number, invited: number) =>
    message("MEETING_INVITED", to, `Meeting scheduled: ${meeting.title}`, `You scheduled "${meeting.title}" (${meeting.meetingNo}); ${invited} ${invited === 1 ? "person was" : "people were"} told.${when(meeting)}`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  updated: (meeting: MeetingInfo, to: number, what: string) => message("MEETING_UPDATED", to, `Meeting ${meeting.meetingNo}: ${what}`, `"${meeting.title}" (${meeting.meetingNo}): ${what}.${when(meeting)}`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  cancelled: (meeting: MeetingInfo, to: number, by: string, reason: string) => message("MEETING_CANCELLED", to, `Meeting cancelled: ${meeting.title}`, `${by} cancelled "${meeting.title}" (${meeting.meetingNo}). Reason: ${reason}`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  toApprove: (meeting: MeetingInfo, to: number, by: string, what: "meeting points" | "MOM") => message("MEETING_APPROVAL", to, `To approve: ${what} of ${meeting.meetingNo}`, `${by} sent the ${what} of "${meeting.title}" (${meeting.meetingNo}) for your approval.`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  decided: (meeting: MeetingInfo, to: number, by: string, what: "meeting points" | "MOM", approved: boolean, remarks: string) =>
    message("MEETING_DECIDED", to, `${what === "MOM" ? "MOM" : "Meeting points"} ${approved ? "approved" : "returned"}: ${meeting.meetingNo}`, `${by} ${approved ? "approved" : "returned"} the ${what} of "${meeting.title}" (${meeting.meetingNo}).${remarks ? ` Remarks: ${remarks}` : ""}`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  published: (meeting: MeetingInfo, to: number, what: "meeting points" | "MOM") => message("MEETING_PUBLISHED", to, `${what === "MOM" ? "MOM" : "Meeting points"} ready: ${meeting.title}`, `The ${what} of "${meeting.title}" (${meeting.meetingNo}) are ready to read.${when(meeting)}`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  reminder: (meeting: MeetingInfo, to: number, what: "meeting points" | "MOM", due: Date) => message("MEETING_REMINDER", to, `Due soon: ${what} of ${meeting.meetingNo}`, `The ${what} of "${meeting.title}" (${meeting.meetingNo}) are due by ${indiaDateTimeText(due)}.`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  responded: (meeting: MeetingInfo, to: number, by: string, answer: string) => message("MEETING_UPDATED", to, `${by}: ${answer.toLowerCase()} for ${meeting.meetingNo}`, `${by} answered "${answer}" for "${meeting.title}" (${meeting.meetingNo}).`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
  actionReview: (meeting: MeetingInfo, to: number, by: string, confirmed: boolean, title: string, note: string) =>
    message("MEETING_ACTION", to, `Action ${confirmed ? "confirmed" : "sent back"}: ${title.slice(0, 80)}`, `${by} ${confirmed ? "confirmed as done" : "sent back"} the action "${title}" from "${meeting.title}" (${meeting.meetingNo}).${note ? ` Note: ${note}` : ""}`, meetingPath(meeting), { type: "MEETING", id: meeting.id }),
};

// v1.55.0 (D-326): the Ticketing System's messages.
export interface TicketInfo {
  id: number;
  ticketNo: string;
  title: string;
}
const ticketPath = (ticket: TicketInfo) => `/users/tickets/${ticket.id}`;
const ticketMessage = (event: string, ticket: TicketInfo, to: number, title: string, text: string) => message(event, to, title, text, ticketPath(ticket), { type: "TICKET", id: ticket.id });
export const ticketMessages = {
  submitted: (ticket: TicketInfo, to: number) => ticketMessage("TICKET_SUBMITTED", ticket, to, `Ticket raised: ${ticket.ticketNo}`, `Your ticket "${ticket.title}" (${ticket.ticketNo}) was raised. Its coordinators have been told.`),
  forCoordinator: (ticket: TicketInfo, to: number, by: string, form: string) => ticketMessage("TICKET_NEW", ticket, to, `New ticket to allot: ${ticket.ticketNo}`, `${by} raised "${ticket.title}" (${ticket.ticketNo}, ${form}). Review it and assign someone.`),
  assigned: (ticket: TicketInfo, to: number, by: string, taskNo: string) => ticketMessage("TICKET_ASSIGNED", ticket, to, `Ticket assigned to you: ${ticket.ticketNo}`, `${by} assigned you the ticket "${ticket.title}" (${ticket.ticketNo}). Work on it in task ${taskNo}.`),
  updated: (ticket: TicketInfo, to: number, what: string) => ticketMessage("TICKET_UPDATED", ticket, to, `Ticket ${ticket.ticketNo}: ${what}`, `"${ticket.title}" (${ticket.ticketNo}): ${what}.`),
  infoRequested: (ticket: TicketInfo, to: number, by: string) => ticketMessage("TICKET_INFO_REQUESTED", ticket, to, `More information needed: ${ticket.ticketNo}`, `${by} asked for more information on your ticket "${ticket.title}" (${ticket.ticketNo}). Open it to answer.`),
  infoProvided: (ticket: TicketInfo, to: number, by: string) => ticketMessage("TICKET_INFO_PROVIDED", ticket, to, `Information added: ${ticket.ticketNo}`, `${by} answered on "${ticket.title}" (${ticket.ticketNo}).`),
  comment: (ticket: TicketInfo, to: number, by: string) => ticketMessage("TICKET_COMMENT", ticket, to, `New comment on ticket ${ticket.ticketNo}`, `${by} commented on "${ticket.title}" (${ticket.ticketNo}).`),
  rejected: (ticket: TicketInfo, to: number, by: string, reason: string) => ticketMessage("TICKET_REJECTED", ticket, to, `Ticket rejected: ${ticket.ticketNo}`, `${by} rejected your ticket "${ticket.title}" (${ticket.ticketNo}). Reason: ${reason}`),
  cancelled: (ticket: TicketInfo, to: number, by: string) => ticketMessage("TICKET_CANCELLED", ticket, to, `Ticket cancelled: ${ticket.ticketNo}`, `${by} cancelled the ticket "${ticket.title}" (${ticket.ticketNo}).`),
  confirmationRequested: (ticket: TicketInfo, to: number, by: string, confirmBy: string) =>
    ticketMessage("TICKET_CONFIRM", ticket, to, `Work done on ${ticket.ticketNo}: please confirm`, `${by} completed the work on your ticket "${ticket.title}" (${ticket.ticketNo}). Open it to confirm, or reopen it if it isn't solved. With no answer, it closes by itself after ${confirmBy}.`),
  confirmReminder: (ticket: TicketInfo, to: number, confirmBy: string) =>
    ticketMessage("TICKET_CONFIRM_REMINDER", ticket, to, `Reminder: confirm ticket ${ticket.ticketNo}`, `The work on "${ticket.title}" (${ticket.ticketNo}) is done and waits for your confirmation. It closes by itself after ${confirmBy}.`),
  closed: (ticket: TicketInfo, to: number, how: string) => ticketMessage("TICKET_CLOSED", ticket, to, `Ticket closed: ${ticket.ticketNo}`, `"${ticket.title}" (${ticket.ticketNo}) is closed: ${how}.`),
  reopened: (ticket: TicketInfo, to: number, by: string, reason: string) => ticketMessage("TICKET_REOPENED", ticket, to, `Ticket reopened: ${ticket.ticketNo}`, `${by} reopened "${ticket.title}" (${ticket.ticketNo}). Reason: ${reason}`),
};
