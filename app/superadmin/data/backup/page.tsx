import type { Metadata } from "next";
import Link from "next/link";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { featureMode } from "@/server/settings/features";
import { getEnv } from "@/config/environment";
import { getSettingValue } from "@/server/settings/values";
import { backupEncryptionKey } from "@/server/ops/backup";
import { loadDriveSettings } from "@/server/ops/gdrive-backup";
import { centreSnapshot } from "@/server/ops/backup-centre/service";
import { s3Config } from "@/server/ops/backup-centre/moves";
import { BackupCentre } from "@/features/superadmin/backup/BackupCentre";
import { ImportTrapNotice } from "@/features/superadmin/backup/ImportTrapNotice";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";
import { DriveBackupTestPanel } from "@/features/superadmin/DriveBackupTestPanel";
import { listRawSettings } from "@/lib/db/repositories/settings.repository";

export const metadata: Metadata = { title: "Backup, restore & migrate" };
export const dynamic = "force-dynamic";

// D-408 (v1.81.0, BK-1, owner brief docs/ops/BACKUP-CENTRE-BRIEF.md): back up
// the whole system (database, every attachment, the server secrets) into one
// encrypted package, restore it here or on another server, with a check
// first and a safety snapshot before anything changes. Super Admin only.
export default async function BackupCentrePage() {
  await requireArea("superadmin");
  const mode = await featureMode("backup_centre");
  const header = (
    <PageHeader
      title="Backup, restore & migrate"
      description="The whole system in one encrypted file: database, every attachment and the server secrets. Restore it here, or move the system to another server and back."
    />
  );
  if (mode === "OFF") {
    return (
      <>
        {header}
        <ImportTrapNotice />
        <p role="status" className="card mt-6 px-5 py-4 text-label">
          The centre is switched off. Switch on &quot;Backup, restore &amp; migrate centre&quot; in{" "}
          <Link className="link" href="/superadmin/security/features">
            Security &amp; access → Feature switches
          </Link>
          . Only the Super Admin can use it, whatever the switch says.
        </p>
        <OffsiteSettings />
      </>
    );
  }
  const [initial, schedule, driveReady, s3Ready] = await Promise.all([
    centreSnapshot(),
    getSettingValue("backup.package_schedule").catch(() => "OFF"),
    loadDriveSettings().then(
      () => true,
      () => false,
    ),
    // v1.82.0 (D-409): S3-compatible storage from Providers & security → Off-site backup.
    s3Config().then(
      (config) => Boolean(config),
      () => false,
    ),
  ]);
  let serverKeySet = false;
  try {
    serverKeySet = Boolean(backupEncryptionKey());
  } catch {
    serverKeySet = false;
  }
  return (
    <>
      {header}
      <ImportTrapNotice />
      <div className="mt-6">
        <BackupCentre initial={initial} databaseName={getEnv().DB_NAME} driveReady={driveReady} serverKeySet={serverKeySet} schedule={schedule ?? "OFF"} s3Ready={s3Ready} />
      </div>
      <OffsiteSettings />
    </>
  );
}

// v1.84.0 (D-411, owner's redesign): the off-site settings (S3-compatible
// storage and Google Drive) moved here from Providers & security, so backup
// is set up in one place. The same encrypted settings, per-group Save,
// history and audit; the Drive Test reads the folder and uploads nothing.
async function OffsiteSettings() {
  const raw = await listRawSettings();
  const byKey = new Map(raw.map((row) => [row.key, row]));
  return (
    <section aria-labelledby="offsite-title" className="mt-8">
      <h2 id="offsite-title" className="mb-3 text-subhead font-semibold">
        Off-site copies and schedule
      </h2>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <SettingsGroupSection group="BACKUP" testId="settings-backup" />
          <SettingsGroupSection group="GDRIVE_BACKUP" testId="settings-gdrive" />
        </div>
        <div className="space-y-6">
          <DriveBackupTestPanel configured={Boolean(byKey.get("backup.gdrive_service_account_json")?.value && byKey.get("backup.gdrive_folder_id")?.value)} />
          <SettingsHistory groups={["BACKUP", "GDRIVE_BACKUP"]} />
        </div>
      </div>
    </section>
  );
}
