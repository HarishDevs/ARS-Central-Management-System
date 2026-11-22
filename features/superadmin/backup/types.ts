// D-408 (v1.81.0, BK-1): shapes shared by the Backup, restore & migrate
// centre's server code and its page. No secrets ever travel in these.
export interface RunView {
  id: number;
  kind: "BACKUP" | "VERIFY" | "RESTORE" | "DRIVE_COPY" | "DRIVE_FETCH";
  trigger: "MANUAL" | "SCHEDULED" | "SAFETY";
  status: "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | "ROLLED_BACK";
  phase: string;
  mode: string | null;
  packageName: string | null;
  keyKind: "PASSPHRASE" | "SERVER_KEY" | null;
  progress: { done: number; total: number };
  message: string | null;
  error: string | null;
  summary: Record<string, unknown> | null;
  options: Record<string, unknown>;
  createdAt: string;
  finishedAt: string | null;
}

export interface PackageRow {
  name: string;
  bytes: number;
  createdAt: string;
  kind: string;
  keyKind: "PASSPHRASE" | "SERVER_KEY";
  appVersion: string | null;
  tables: number | null;
  rows: number | null;
  files: number | null;
  checked: boolean;
  source: string | null;
  createdBy: string | null;
  deleteAfterDownload: boolean;
}

export const KIND_LABEL: Record<RunView["kind"], string> = {
  BACKUP: "Backup",
  VERIFY: "Check",
  RESTORE: "Restore",
  DRIVE_COPY: "Copy to Google Drive",
  DRIVE_FETCH: "Copy from Google Drive",
};

export const STATUS_LABEL: Record<RunView["status"], string> = {
  RUNNING: "Running",
  DONE: "Done",
  FAILED: "Failed",
  CANCELLED: "Stopped",
  ROLLED_BACK: "Undone",
};

export const PACKAGE_KIND_LABEL: Record<string, string> = {
  full: "Full",
  database: "Database only",
  safety: "Safety snapshot",
  scheduled: "Scheduled",
  upload: "Uploaded",
  drive: "From Google Drive",
  received: "Received",
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

// Passphrase strength shown while typing (the server enforces the minimum).
export function passphraseHint(value: string): { ok: boolean; text: string } {
  if (value.length === 0) return { ok: false, text: "At least 12 characters. A short sentence works well." };
  if (value.length < 12) return { ok: false, text: `${12 - value.length} more character(s) needed.` };
  if (/^(.)\1+$/.test(value)) return { ok: false, text: "Don't repeat one character." };
  const words = value.trim().split(/\s+/).length;
  return { ok: true, text: value.length >= 20 || words >= 4 ? "Strong. Keep it safe: without it the package can't be opened." : "Fine. Longer is stronger." };
}
