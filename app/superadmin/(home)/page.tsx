import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { Hint } from "@/features/ui/Hint";
import { requireArea } from "@/server/authorization/guards";
import { SETTING_DEFINITIONS } from "@/server/settings/definitions";
import { resolveSettingForDisplay } from "@/server/settings/resolve";
import { listRawSettings } from "@/lib/db/repositories/settings.repository";
import { backupStatus } from "@/server/ops/backup";
import { formatIndiaTime } from "@/server/notifications/security-messages";
import { BackupNowButton } from "@/features/superadmin/BackupNowButton";
import { ImportTrapNotice } from "@/features/superadmin/backup/ImportTrapNotice";
import { checkStorage } from "@/server/attachments/storage";
import { originLockOn } from "@/server/ops/origin-lock";
import { loadHealthCards, type HealthCard } from "@/server/panels/health";
import { SETTING_GROUP_PAGE } from "@/server/panels/superadmin-nav";
import { ConsoleLayout } from "@/features/ui/ConsoleLayout";
import { HealthBadge, HealthIcon, StatusCard } from "@/features/ui/StatusCard";
import { HealthTestButton } from "@/features/superadmin/HealthTest";
import { splitLabel } from "@/features/superadmin/split-label";

// WEB-05 (v1.10.0): a plain, non-confidential browser title.
export const metadata: Metadata = { title: "Health console" };
export const dynamic = "force-dynamic";

const GROUPS: HealthCard["group"][] = ["Connections", "Jobs & backups", "Platform"];
const ORDER = { FAILED: 0, WARNING: 1, OFF: 2, OK: 3 } as const;

// v1.84.0 (D-411, owner's redesign): the Super Admin's start page is the
// Health console (after the Astryx incident-console template, structure
// only): a status card per provider, job, backup and delivery (OK, Warning,
// Failed or Not set up, each with an icon and a word, the last check and a
// Test), a Needs action list, and the details underneath (provider keys,
// file storage, origin lock, backups). Shows whether each secret is stored,
// never the secret itself (D-016).
export default async function HealthConsole() {
  await requireArea("superadmin");
  const [cards, raw, storage] = await Promise.all([loadHealthCards(), listRawSettings(), checkStorage()]);
  const byKey = new Map(raw.map((row) => [row.key, row]));
  const secrets = SETTING_DEFINITIONS.filter((definition) => definition.encrypted).map((definition) => ({ ...resolveSettingForDisplay(definition, byKey.get(definition.key) ?? null), href: SETTING_GROUP_PAGE[definition.group] }));
  const backups = backupStatus();
  const originLock = originLockOn();
  const needs = cards.filter((card) => card.health === "FAILED" || card.health === "WARNING" || (card.health === "OFF" && card.action)).sort((a, b) => ORDER[a.health] - ORDER[b.health]);
  const counts = { FAILED: cards.filter((card) => card.health === "FAILED").length, WARNING: cards.filter((card) => card.health === "WARNING").length };

  return (
    <>
      <PageHeader
        title="Health console"
        description="Every provider, job, backup and delivery at a glance. A card says OK, Warning, Failed or Not set up, when it was last checked, and has a Test or an Open. Only visible to the Super Admin."
        meta={counts.FAILED || counts.WARNING ? `${counts.FAILED} failed, ${counts.WARNING} with a warning` : "Everything that is set up is OK"}
      />
      <ConsoleLayout
        testId="health-console"
        listLabel="Status"
        list={GROUPS.map((group) => (
          <div key={group}>
            <h2 className="mb-3 font-semibold">{group}</h2>
            <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {cards
                .filter((card) => card.group === group)
                .map((card) => (
                  <li key={card.key}>
                    <StatusCard
                      testId={`health-${card.key}`}
                      title={card.title}
                      health={card.health}
                      detail={card.detail}
                      checked={card.checked}
                      href={card.href}
                      test={card.test ? <HealthTestButton test={card.test} title={card.title} /> : undefined}
                    />
                  </li>
                ))}
            </ul>
          </div>
        ))}
        detailsLabel="Needs action"
        details={
          <section className="card" data-testid="needs-action">
            <h2 className="border-b border-line px-5 py-4 font-semibold">Needs action</h2>
            {needs.length === 0 ? (
              <p role="status" className="flex items-center gap-2 px-5 py-4 text-label text-success-600">
                <HealthIcon health="OK" /> Nothing needs action.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {needs.map((card) => (
                  <li key={card.key} className="space-y-1 px-5 py-3 text-label">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={card.href} className="link font-medium">
                        {card.title}
                      </Link>
                      <HealthBadge health={card.health} />
                    </div>
                    <p className="text-ink-muted">{card.action ?? card.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        }
        logLabel="Details"
        log={
          <div className="space-y-6">
            <section className="card">
              <h2 className="border-b border-line px-5 py-3 font-semibold">Provider keys</h2>
              <ul className="divide-y divide-line">
                {secrets.map((setting) => (
                  <li key={setting.key} className="flex items-center justify-between gap-3 px-5 py-3 text-label">
                    <Link href={setting.href} className="link">
                      {splitLabel(setting.label).name}
                    </Link>
                    {/* v1.74.1 (D-397): the badge stays on one line. */}
                    <HealthBadge health={setting.status === "CONFIGURED" ? "OK" : "OFF"} label={setting.status === "CONFIGURED" ? "Configured" : "Not configured"} />
                  </li>
                ))}
              </ul>
            </section>
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Q-021 (owner, 2 Nov 2026): whether the Cloudflare origin lock is on. */}
              <section id="origin" className="card scroll-mt-20" data-testid="origin-lock-status">
                <h2 className="flex items-center gap-1.5 border-b border-line px-5 py-3 font-semibold">
                  Origin lock
                  <Hint text="With ORIGIN_SECRET set on the server, only requests that come through Cloudflare are served, so nobody can reach the GoDaddy origin directly or fake their IP address. The value is never shown here." align="start" />
                </h2>
                <div className="space-y-2 px-5 py-4 text-label">
                  <p role="status">
                    <HealthBadge health={originLock ? "OK" : "WARNING"} label={originLock ? "Origin lock: on" : "Origin lock: off"} />
                  </p>
                  {!originLock && <p className="text-ink-muted">Set ORIGIN_SECRET (GoDaddy → the app → Secrets) and the matching Cloudflare Transform Rule, then Publish. See the deployment guide.</p>}
                </div>
              </section>
              {/* v1.12.4 (D-163): uploads need a folder the app can write to. */}
              <section id="storage" className="card scroll-mt-20" data-testid="storage-status">
                <h2 className="border-b border-line px-5 py-3 font-semibold">File storage</h2>
                <div className="space-y-2 px-5 py-4 text-label">
                  <p role="status">
                    <HealthBadge health={storage.ok ? "OK" : "FAILED"} label={storage.ok ? "Uploads work" : "Uploads are failing"} />
                  </p>
                  <p className="text-ink-muted">
                    Folder in use: <code className="break-all">{storage.root}</code> ({storage.configured ? "from UPLOAD_DIR" : "UPLOAD_DIR not set: the app's own folder"})
                    {storage.code ? ` · error ${storage.code}` : ""}
                  </p>
                </div>
              </section>
            </div>
            <section className="card">
              <h2 className="flex items-center gap-1.5 border-b border-line px-5 py-3 font-semibold">
                Backups
                <Hint text="Database and attachments are copied to the backup folder on the server (BACKUP_DIR). Download a copy now and then; how to restore is in the deployment guide, Part P." align="start" />
              </h2>
              <div className="space-y-3 px-5 py-4">
                <p role="status" className="text-label">
                  {backups.latest
                    ? `Last backup ${formatIndiaTime(backups.latest.at)} (${(backups.latest.bytes / 1024).toLocaleString("en-IN", { maximumFractionDigits: 0 })} KB); ${backups.count} kept.`
                    : "No backup yet. The job runner makes one a day once the cron job is set up, or press Back up now."}
                </p>
                <BackupNowButton />
                <p className="text-label text-ink-muted">
                  For a full encrypted backup with every attachment and the server secrets, a restore with a safety snapshot, or a move to another server, open{" "}
                  <Link className="link" href="/superadmin/data/backup">
                    Backup, restore &amp; migrate
                  </Link>
                  .
                </p>
                <ImportTrapNotice withLink />
              </div>
            </section>
          </div>
        }
      />
    </>
  );
}
