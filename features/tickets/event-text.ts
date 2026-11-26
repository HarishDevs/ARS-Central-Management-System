// v1.55.0 ticket timeline words; v1.57.2 (D-339): shared by the ticket page and
// its task's page (the ticket's activity shows on both).
export const TICKET_EVENT_TEXT: Record<string, string> = {
  RAISED: "Raised",
  ASSIGNED: "Assigned",
  REASSIGNED: "Reassigned",
  REASSIGNED_AFTER_REOPEN: "Assigned again after reopening",
  WORK_STARTED: "Work started",
  WORK_COMPLETED: "Work completed",
  CONFIRM_REMINDER: "Reminder sent to confirm",
  CONFIRMED: "Confirmed and closed",
  REOPENED: "Reopened",
  AUTO_CLOSED: "Closed automatically",
  REMARK: "Remark",
  FILES_ADDED: "Files added",
  // v1.92.0 (D-438): collaborators.
  COLLABORATORS_ADDED: "Collaborators added",
  COLLABORATOR_REMOVED: "Collaborator removed",
};
