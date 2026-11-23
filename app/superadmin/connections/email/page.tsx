import type { Metadata } from "next";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { ConnectionStatus } from "@/features/superadmin/ConnectionStatus";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";
import { TestSendPanel } from "@/features/superadmin/TestSendPanel";
import { EmailDiagnosticsPanel } from "@/features/superadmin/EmailDiagnosticsPanel";

export const metadata: Metadata = { title: "Email" };
export const dynamic = "force-dynamic";

// v1.84.0 (D-411, owner's redesign): Connections → Email. Status, the email
// settings (keys encrypted, never shown again), Send test email and the
// diagnostic together on one page. Super Admin only; every action re-checks.
export default async function EmailConnectionPage() {
  const { user } = await requireArea("superadmin");
  return (
    <>
      <PageHeader title="Email" description="How the app sends email: Resend, or the GoDaddy cPanel mailbox (SMTP) with Resend as a fallback. Keys are stored encrypted and are never shown again after saving. Every change is recorded." />
      <ConnectionStatus keys={["email"]} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsGroupSection group="EMAIL" testId="settings-email" />
        <div className="space-y-6">
          <TestSendPanel email={user.email} whatsapp={user.whatsappNumber} only="EMAIL" />
          <EmailDiagnosticsPanel email={user.email} />
          <SettingsHistory groups={["EMAIL"]} />
        </div>
      </div>
    </>
  );
}
