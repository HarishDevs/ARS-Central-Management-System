import "server-only";
import type { Health } from "@/features/ui/StatusCard";
import { SETTING_DEFINITIONS } from "@/server/settings/definitions";
import { resolveSettingForDisplay } from "@/server/settings/resolve";
import { listRawSettings } from "@/lib/db/repositories/settings.repository";
import { listRecentDeliveries, type DeliveryListItem } from "@/lib/db/repositories/notifications.repository";
import { getRunnerHeartbeat } from "@/lib/db/repositories/jobs.repository";
import { countAllActiveDevices } from "@/lib/db/repositories/push.repository";
import { loadSettingsRow } from "@/lib/db/repositories/gcal.repository";
import { getConnection } from "@/lib/db/repositories/salesforce.repository";
import { integrationStatus, STATUS_LABEL } from "@/server/calendar/config";
import { backupStatus } from "@/server/ops/backup";
import { checkStorage, STORAGE_PROBLEM_TEXT } from "@/server/attachments/storage";
import { originLockOn } from "@/server/ops/origin-lock";
import { loadTemplateBoard } from "@/server/notifications/template-registry";
import { templatesNeedingAttention } from "@/server/notifications/template-reminder";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { logError } from "@/lib/logging/logger";

// v1.84.0 (D-411, owner's redesign): the Health console's cards. Each says
// OK / Warning / Failed / Not set up from what the app already records (the
// settings' Configured state, the delivery log, the job runner's heartbeat,
// the backup folder, the storage probe); no secret value is ever read out,
// only whether one is stored. A check that can't be read is a Warning with
// "couldn't check", never a false OK.
export type HealthKey = "email" | "whatsapp" | "push" | "google_signin" | "google_calendar" | "salesforce" | "ai" | "jobs" | "backup" | "offsite" | "storage" | "origin" | "deliveries";

export interface HealthCard {
  key: HealthKey;
  title: string;
  group: "Connections" | "Jobs & backups" | "Platform";
  health: Health;
  detail: string;
  checked: string | null;
  href: string;
  // What to do when it isn't OK (the Needs action list).
  action?: string;
  test?: "EMAIL" | "WHATSAPP" | "DRIVE";
}

const BACKUP_MAX_AGE_HOURS = 26;
const DAY_MS = 86_400_000;

// The delivery log's view of one channel: the newest attempt and failures in the last day.
export function channelHealth(rows: readonly Pick<DeliveryListItem, "channel" | "status" | "createdAt">[], channel: "EMAIL" | "WHATSAPP", configured: boolean, now = Date.now()): { health: Health; latest: Date | null; failed: number } {
  const mine = rows.filter((row) => row.channel === channel);
  const latest = mine[0]?.createdAt ?? null;
  const failed = mine.filter((row) => row.status === "FAILED" && now - new Date(row.createdAt).getTime() < DAY_MS).length;
  if (!configured) return { health: "OFF", latest, failed };
  if (mine[0]?.status === "FAILED") return { health: "FAILED", latest, failed };
  return { health: failed > 0 ? "WARNING" : "OK", latest, failed };
}

async function safe<T>(label: string, run: () => Promise<T> | T): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    logError(`health console: ${label} failed`, error);
    return null;
  }
}

export async function loadHealthCards(): Promise<HealthCard[]> {
  const now = new Date();
  const live = formatIndiaTime(now);
  const [raw, deliveries, heartbeat, devices, gcal, salesforce, storage, templates] = await Promise.all([
    safe("settings", () => listRawSettings()),
    safe("deliveries", () => listRecentDeliveries(300)),
    safe("job runner", () => getRunnerHeartbeat()),
    safe("devices", () => countAllActiveDevices()),
    safe("google calendar", () => loadSettingsRow()),
    safe("salesforce", () => getConnection()),
    safe("storage", () => checkStorage()),
    safe("templates", () => loadTemplateBoard()),
  ]);
  const byKey = new Map((raw ?? []).map((row) => [row.key, row]));
  const configured = (key: string) => {
    const definition = SETTING_DEFINITIONS.find((item) => item.key === key);
    return Boolean(definition && resolveSettingForDisplay(definition, byKey.get(key) ?? null).status === "CONFIGURED");
  };
  const cards: HealthCard[] = [];

  // Email: Resend or the SMTP mailbox.
  const emailReady = configured("email.resend_api_key") || configured("email.smtp_password");
  const email = channelHealth(deliveries ?? [], "EMAIL", emailReady, now.getTime());
  cards.push({
    key: "email",
    title: "Email",
    group: "Connections",
    health: deliveries === null && emailReady ? "WARNING" : email.health,
    detail: !emailReady ? "No email key is saved: messages can't go by email." : deliveries === null ? "Couldn't read the delivery log just now." : email.failed ? `${email.failed} email${email.failed === 1 ? "" : "s"} failed in the last 24 hours.` : "Keys saved; the latest emails went out.",
    checked: email.latest ? formatIndiaTime(email.latest) : null,
    href: "/superadmin/connections/email",
    action: email.health === "OK" ? undefined : emailReady ? "Open Email, send a test and run the diagnostic." : "Save the Resend key or the SMTP mailbox in Email.",
    test: emailReady ? "EMAIL" : undefined,
  });

  // WhatsApp: the CEOITBox key, the delivery log and the templates still to switch on.
  const waReady = configured("whatsapp.ceoitbox_api_key");
  const wa = channelHealth(deliveries ?? [], "WHATSAPP", waReady, now.getTime());
  const pending = templates ? templatesNeedingAttention(templates) : [];
  const waHealth: Health = wa.health === "OK" && pending.length ? "WARNING" : wa.health;
  cards.push({
    key: "whatsapp",
    title: "WhatsApp",
    group: "Connections",
    health: waHealth,
    detail: !waReady ? "No CEOITBox key is saved: WhatsApp messages are skipped." : wa.failed ? `${wa.failed} WhatsApp message${wa.failed === 1 ? "" : "s"} failed in the last 24 hours.` : pending.length ? `${pending.length} template${pending.length === 1 ? " isn't" : "s aren't"} live yet: those messages go by email and in-app only.` : "Key saved; the latest messages went out.",
    checked: wa.latest ? formatIndiaTime(wa.latest) : null,
    href: pending.length && wa.health === "OK" ? "/superadmin/connections/whatsapp/templates" : "/superadmin/connections/whatsapp",
    action: waHealth === "OK" ? undefined : !waReady ? "Save the CEOITBox key in WhatsApp." : pending.length && wa.health === "OK" ? "Switch on the templates in WhatsApp templates." : "Open WhatsApp and send a test.",
    test: waReady ? "WHATSAPP" : undefined,
  });

  const pushReady = configured("push.vapid_private_key") || Boolean(byKey.get("push.vapid_public_key")?.value);
  cards.push({
    key: "push",
    title: "Phone & desktop notifications",
    group: "Connections",
    health: pushReady ? "OK" : "OFF",
    detail: pushReady ? `Keys set; ${devices ?? 0} device${devices === 1 ? "" : "s"} registered.` : "No keys yet: people can't turn on notifications.",
    checked: live,
    href: "/superadmin/connections/push",
    action: pushReady ? undefined : "Generate keys in Phone & desktop notifications.",
  });

  // Google sign-in: whether the server's Firebase credentials are set (never their values).
  const firebase = Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY);
  cards.push({
    key: "google_signin",
    title: "Google sign-in",
    group: "Connections",
    health: firebase ? "OK" : "FAILED",
    detail: firebase ? "The server can check Google sign-ins (Firebase credentials are set)." : "FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY is missing: Google sign-in fails.",
    checked: live,
    href: "/superadmin/connections/google",
    action: firebase ? undefined : "Set the three Firebase server variables in GoDaddy, then Publish.",
  });

  const calendar = gcal ? integrationStatus({ enabled: gcal.enabled, maintenance: gcal.maintenance, clientId: gcal.clientId, hasSecret: Boolean(gcal.secretEnc), lastTestOk: gcal.lastTestOk }) : null;
  cards.push({
    key: "google_calendar",
    title: "Google Calendar",
    group: "Connections",
    health: calendar === null ? "WARNING" : calendar === "ENABLED" ? "OK" : calendar === "NOT_CONFIGURED" || calendar === "DISABLED" ? "OFF" : "WARNING",
    detail: calendar === null ? "Couldn't read the calendar settings just now." : `Status: ${STATUS_LABEL[calendar]}.`,
    checked: gcal?.lastTestAt ? formatIndiaTime(gcal.lastTestAt) : null,
    href: "/superadmin/connections/google",
    action: calendar === "MAINTENANCE" ? "Calendar sync is paused for maintenance." : undefined,
  });

  cards.push({
    key: "salesforce",
    title: "Salesforce",
    group: "Connections",
    health: salesforce === null ? "WARNING" : salesforce.status === "CONNECTED" ? "OK" : salesforce.status === "NEEDS_REAUTH" ? "FAILED" : "OFF",
    detail: salesforce === null ? "Couldn't read the connection just now." : salesforce.status === "CONNECTED" ? "Connected (read-only)." : salesforce.status === "NEEDS_REAUTH" ? "Salesforce asks to connect again." : "Not connected.",
    checked: null,
    href: "/superadmin/connections/salesforce",
    action: salesforce?.status === "NEEDS_REAUTH" ? "Open Salesforce and press Connect again." : undefined,
  });

  const aiKeys = SETTING_DEFINITIONS.filter((definition) => definition.group === "AI" && definition.encrypted && configured(definition.key)).length;
  cards.push({
    key: "ai",
    title: "AI providers",
    group: "Connections",
    health: aiKeys > 0 ? "OK" : "OFF",
    detail: aiKeys > 0 ? `${aiKeys} provider key${aiKeys === 1 ? "" : "s"} saved.` : "No AI provider key is saved.",
    checked: null,
    href: "/superadmin/connections/ai",
  });

  cards.push({
    key: "jobs",
    title: "Job runner",
    group: "Jobs & backups",
    health: heartbeat === null ? "FAILED" : heartbeat.minutesAgo <= 15 ? "OK" : "FAILED",
    detail: heartbeat === null ? "The job runner has never run (or couldn't be read): reminders, backups and retries stop." : heartbeat.minutesAgo <= 15 ? `Last ran ${heartbeat.minutesAgo} minute${heartbeat.minutesAgo === 1 ? "" : "s"} ago.` : `Last ran ${heartbeat.minutesAgo} minutes ago: it should run every 5 minutes.`,
    checked: heartbeat ? formatIndiaTime(new Date(now.getTime() - heartbeat.minutesAgo * 60_000)) : null,
    href: "/superadmin/monitoring/jobs",
    action: heartbeat !== null && heartbeat.minutesAgo <= 15 ? undefined : "Check the cron job in cPanel (see the deployment guide).",
  });

  const backups = await safe("backups", () => backupStatus());
  const ageHours = backups?.latest ? (now.getTime() - backups.latest.at.getTime()) / 3_600_000 : null;
  cards.push({
    key: "backup",
    title: "Daily backup",
    group: "Jobs & backups",
    health: backups === null ? "WARNING" : ageHours === null ? "FAILED" : ageHours <= BACKUP_MAX_AGE_HOURS ? "OK" : "WARNING",
    detail: backups === null ? "Couldn't read the backup folder." : backups.latest ? `Newest backup ${Math.round(ageHours ?? 0)} h old; ${backups.count} kept.` : "No backup yet.",
    checked: backups?.latest ? formatIndiaTime(backups.latest.at) : null,
    href: "/superadmin/data/backup",
    action: ageHours !== null && ageHours <= BACKUP_MAX_AGE_HOURS ? undefined : "Open Backup, restore & migrate and back up now.",
  });

  const s3 = configured("backup.s3_secret_access_key") && Boolean(byKey.get("backup.s3_bucket")?.value);
  const drive = configured("backup.gdrive_service_account_json") && Boolean(byKey.get("backup.gdrive_folder_id")?.value);
  cards.push({
    key: "offsite",
    title: "Off-site copies",
    group: "Jobs & backups",
    health: s3 || drive ? "OK" : "WARNING",
    detail: s3 && drive ? "S3-compatible storage and Google Drive are both set." : s3 ? "S3-compatible storage is set." : drive ? "Google Drive is set." : "No off-site copy: a lost hosting account would lose the backups too.",
    checked: null,
    href: "/superadmin/data/backup#settings-BACKUP",
    action: s3 || drive ? undefined : "Set S3-compatible storage or Google Drive in Backup, restore & migrate.",
    test: drive ? "DRIVE" : undefined,
  });

  cards.push({
    key: "storage",
    title: "File storage",
    group: "Platform",
    health: storage === null ? "WARNING" : storage.ok ? "OK" : "FAILED",
    detail: storage === null ? "Couldn't check the upload folder." : storage.ok ? "Uploads work: the app can write to the upload folder." : `Uploads are failing. ${STORAGE_PROBLEM_TEXT[storage.problem ?? "OTHER"]}`,
    checked: live,
    href: "/superadmin#storage",
    action: storage?.ok === false ? "Fix UPLOAD_DIR on the server (see the deployment guide)." : undefined,
  });

  const origin = originLockOn();
  cards.push({
    key: "origin",
    title: "Origin lock",
    group: "Platform",
    health: origin ? "OK" : "WARNING",
    detail: origin ? "Only requests through Cloudflare are served." : "Off: the GoDaddy origin can be reached directly.",
    checked: live,
    href: "/superadmin#origin",
    action: origin ? undefined : "Set ORIGIN_SECRET and the matching Cloudflare Transform Rule (deployment guide).",
  });

  const retry = (deliveries ?? []).filter((row) => row.status === "FAILED" && row.nextRetryAt).length;
  const failedDay = (deliveries ?? []).filter((row) => row.status === "FAILED" && now.getTime() - new Date(row.createdAt).getTime() < DAY_MS).length;
  cards.push({
    key: "deliveries",
    title: "Message deliveries",
    group: "Platform",
    health: deliveries === null ? "WARNING" : failedDay > 0 ? "WARNING" : "OK",
    detail: deliveries === null ? "Couldn't read the delivery log." : failedDay ? `${failedDay} failed in the last 24 hours; ${retry} waiting to retry.` : "Nothing failed in the last 24 hours.",
    checked: deliveries?.[0] ? formatIndiaTime(deliveries[0].createdAt) : null,
    href: "/superadmin/monitoring/deliveries?status=FAILED",
    action: failedDay ? "Open Message deliveries to see the failure codes and retry." : undefined,
  });
  return cards;
}
