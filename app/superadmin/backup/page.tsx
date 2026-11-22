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
import { BackupCentre } from "@/features/superadmin/backup/BackupCentre";
import { ImportTrapNotice } from "@/features/superadmin/backup/ImportTrapNotice";

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
          <Link className="link" href="/superadmin/settings">
            Providers &amp; security → Features
          </Link>
          . Only the Super Admin can use it, whatever the switch says.
        </p>
      </>
    );
  }
  const [initial, schedule, driveReady] = await Promise.all([
    centreSnapshot(),
    getSettingValue("backup.package_schedule").catch(() => "OFF"),
    loadDriveSettings().then(
      () => true,
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
        <BackupCentre initial={initial} databaseName={getEnv().DB_NAME} driveReady={driveReady} serverKeySet={serverKeySet} schedule={schedule ?? "OFF"} />
      </div>
    </>
  );
}
