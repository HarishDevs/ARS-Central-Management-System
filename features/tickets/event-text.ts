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
  // v1.94.0 (D-456..D-458): Super Admin full control.
  CREATED_ON_BEHALF: "Created by Super Admin on behalf of the requester",
  SUPER_ADMIN_OVERRIDE: "Changed by Super Admin",
  ARCHIVED: "Archived by Super Admin (read-only)",
  UNARCHIVED: "Un-archived by Super Admin",
  BINNED: "Moved to the Deleted items bin by Super Admin",
  RESTORED: "Restored from the Deleted items bin by Super Admin",
};
