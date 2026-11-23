import { EmptyState } from "@/features/ui/Display";
import { SettingsGroupForm } from "@/features/superadmin/SettingsGroupForm";
import { splitLabel } from "@/features/superadmin/split-label";
import { SETTING_DEFINITIONS, type SettingDefinition } from "@/server/settings/definitions";
import { resolveSettingForDisplay } from "@/server/settings/resolve";
import { listRawSettings, listSettingHistory } from "@/lib/db/repositories/settings.repository";
import { formatIndiaTime } from "@/server/notifications/security-messages";

// v1.84.0 (D-411, owner's redesign): the groups of the old "Providers &
// security" page, each now on its own page (Connections, Security & access,
// Data). The encrypted settings, the per-group save, history, audit and the
// "Key replaced" display are unchanged (SettingsGroupForm, saveSettingsGroup).
export const SETTING_GROUPS: Record<Exclude<SettingDefinition["group"], "AI" | "AI_DATA">, { title: string; description: string }> = {
  EMAIL: { title: "Email", description: "Send through Resend, or through the GoDaddy cPanel mailbox (SMTP, e.g. no_reply@cms.arssteels.net) with Resend as a fallback. Save, then use Send test email: it says which way the test went." },
  WHATSAPP: { title: "WhatsApp", description: "CEOITBox, the same number and account as the Power BI site." },
  AUTHENTICATION: { title: "Sign-in security", description: "Code, lockout and device limits. Each value has safe minimum and maximum bounds." },
  GENERAL: { title: "General", description: "Application name, timezone, the maintenance notice and the other app-wide basics." },
  BACKUP: { title: "Off-site backup (S3-compatible)", description: "After each daily backup, an encrypted copy goes to S3-compatible storage outside the hosting account (AWS S3, Cloudflare R2, Backblaze B2, Wasabi). Use a key that may only write to the bucket. The server must have BACKUP_ENCRYPTION_KEY." },
  GDRIVE_BACKUP: { title: "Google Drive backup", description: "After each daily backup, the encrypted file (never a readable copy) goes to an ARS Google Drive folder through a Google service account. Put the folder in a shared drive and add the service account's email as Content manager. Only the newest copies are kept; the app deletes only files it made. Save, then Test. The server must have BACKUP_ENCRYPTION_KEY; its copy stays with the owner." },
  PUSH: { title: "Phone & desktop notifications", description: "Web Push to the devices people register in Profile → App & devices. Make the keys with Generate keys. What a notification shows on a lock screen is chosen here." },
  RETENTION: { title: "Retention values", description: "How long records are kept. 0 keeps them for ever. These values only feed the dry run below and delete nothing by themselves. Security records are deleted after 90 days by their own step (DR-06)." },
  FEATURES: { title: "Feature switches", description: "Turn new features on, off, or on for the IT team only (a trial before everyone). Switching off hides a feature; no data is removed." },
};

export async function SettingsGroupSection({ group, testId, actions }: { group: keyof typeof SETTING_GROUPS; testId?: string; actions?: React.ReactNode }) {
  const raw = await listRawSettings();
  const byKey = new Map(raw.map((row) => [row.key, row]));
  const { title, description } = SETTING_GROUPS[group];
  return (
    <SettingsGroupForm
      group={group}
      title={title}
      description={description}
      testId={testId}
      actions={actions}
      settings={SETTING_DEFINITIONS.filter((definition) => definition.group === group).map((definition) => resolveSettingForDisplay(definition, byKey.get(definition.key) ?? null))}
    />
  );
}

// Recent changes to these groups' settings (who, when; "Key replaced" for a secret, never its value).
export async function SettingsHistory({ groups, limit = 10 }: { groups: SettingDefinition["group"][]; limit?: number }) {
  const keys = new Set(SETTING_DEFINITIONS.filter((definition) => groups.includes(definition.group)).map((definition) => definition.key));
  const labels = new Map(SETTING_DEFINITIONS.map((definition) => [definition.key, splitLabel(definition.label).name]));
  const history = (await listSettingHistory(200)).filter((entry) => keys.has(entry.key)).slice(0, limit);
  return (
    <section className="card" data-testid="settings-history">
      <h2 className="border-b border-line px-5 py-4 font-semibold">Recent changes</h2>
      {history.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No changes yet" />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {history.map((entry, index) => (
            <li key={index} className="px-5 py-3 text-label">
              <p className="font-medium">{labels.get(entry.key) ?? entry.key}</p>
              <p className="text-ink-muted">
                {entry.newRef === "cleared" ? "Removed" : entry.newRef?.startsWith("fp:") ? "Key replaced" : `Set to ${entry.newRef?.slice(2) ?? ""}`}
                {" · "}
                {entry.changedByName ?? "System"} · {formatIndiaTime(entry.changedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
