import "server-only";
import { listUserIdsWithRole } from "@/lib/db/repositories/users.repository";
import { notify } from "@/server/notifications/notify";
import { logError } from "@/lib/logging/logger";
import { appBaseUrl } from "@/lib/http/app-url";

// D-408 (owner brief "Safety"): every package download, restore and migration
// is told to every Super Admin by email and WhatsApp (and in the Inbox), as
// well as being in the audit log. Unlike the daily ops alerts these are never
// held back: each one is a separate event someone should know about.
// The message names what happened and who did it, never a secret.
export type BackupEvent = "DOWNLOADED" | "RESTORE_STARTED" | "RESTORED" | "RESTORE_FAILED" | "ROLLED_BACK" | "SECRETS_VIEWED" | "UPLOADED" | "MIGRATION_SENT" | "MIGRATION_RECEIVED";

const TITLES: Record<BackupEvent, string> = {
  DOWNLOADED: "A full backup was downloaded",
  RESTORE_STARTED: "A restore has started",
  RESTORED: "The system was restored from a backup",
  RESTORE_FAILED: "A restore failed",
  ROLLED_BACK: "A restore failed and was undone",
  SECRETS_VIEWED: "Server secrets in a backup were shown",
  UPLOADED: "A backup package was uploaded",
  MIGRATION_SENT: "The system was sent to another server",
  MIGRATION_RECEIVED: "The system was received from another server",
};

export function backupEventText(event: BackupEvent, detail: string, actorName: string | null): { title: string; message: string } {
  const title = TITLES[event];
  return { title, message: `${detail}${actorName ? ` By ${actorName}.` : ""} If this wasn't expected, check Super Admin → Backup, restore & migrate and the audit log now.` };
}

export async function alertBackupEvent(event: BackupEvent, detail: string, actorName: string | null): Promise<void> {
  try {
    const base = appBaseUrl();
    const { title, message } = backupEventText(event, detail, actorName);
    for (const userId of await listUserIdsWithRole("SUPER_ADMIN")) {
      await notify({
        eventType: "OPS_ALERT",
        userId,
        title,
        message,
        deepLink: `${base}/superadmin/data/backup`,
        email: { subject: `ARS CMS: ${title.toLowerCase()}`, text: `${message}\n\n${base}/superadmin/data/backup` },
        whatsappVariables: { title, message, alert: title, detail: message },
        priority: "HIGH",
      });
    }
  } catch (error) {
    logError("backup event alert failed", error, { event });
  }
}
