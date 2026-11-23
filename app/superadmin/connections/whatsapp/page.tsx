import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { ConnectionStatus } from "@/features/superadmin/ConnectionStatus";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";
import { TestSendPanel } from "@/features/superadmin/TestSendPanel";
import { loadTemplateBoard } from "@/server/notifications/template-registry";
import { templatesNeedingAttention } from "@/server/notifications/template-reminder";
import { HealthBadge } from "@/features/ui/StatusCard";

export const metadata: Metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

// v1.84.0 (D-411, owner's redesign): Connections → WhatsApp. Status, the
// CEOITBox settings, Send test WhatsApp, and the WhatsApp templates (moved
// under WhatsApp; their own pages are /superadmin/connections/whatsapp/templates).
export default async function WhatsAppConnectionPage() {
  const { user } = await requireArea("superadmin");
  const templates = await loadTemplateBoard().catch(() => null);
  const pending = templates ? templatesNeedingAttention(templates) : [];
  return (
    <>
      <PageHeader title="WhatsApp" description="CEOITBox, the same number and account as the Power BI site. The key is stored encrypted and is never shown again after saving. Every change is recorded." />
      <ConnectionStatus keys={["whatsapp"]} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsGroupSection group="WHATSAPP" testId="settings-whatsapp" />
        <div className="space-y-6">
          <TestSendPanel email={user.email} whatsapp={user.whatsappNumber} only="WHATSAPP" />
          {/* Q-013 (owner, 2 Nov 2026): the templates still to switch on. */}
          <section className="card" data-testid="template-reminder">
            <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4">
              <h2 className="font-semibold">WhatsApp templates</h2>
              <Link className="link text-label" href="/superadmin/connections/whatsapp/templates">
                Open templates
              </Link>
            </div>
            <div className="space-y-3 px-5 py-4 text-label">
              {templates === null ? (
                <p className="text-ink-muted">Couldn&apos;t load the templates just now.</p>
              ) : (
                <p role="status" className="flex flex-wrap items-center gap-2">
                  <HealthBadge health={pending.length ? "WARNING" : "OK"} />
                  {pending.length === 0 ? `All ${templates.length} templates are live on WhatsApp.` : `${pending.length} of ${templates.length} templates aren't live yet: those messages go by email and in-app only.`}
                </p>
              )}
              {pending.length > 0 && (
                <ul className="space-y-1">
                  {pending.slice(0, 5).map((item) => (
                    <li key={item.code} className="flex items-center justify-between gap-2">
                      <Link className="link inline-flex min-h-6 items-center" href={item.href}>
                        {item.label}
                      </Link>
                      <span className="text-ink-muted">{item.state}</span>
                    </li>
                  ))}
                  {pending.length > 5 && (
                    <li>
                      <Link className="link" href="/superadmin/connections/whatsapp/templates#templates-to-switch-on">
                        and {pending.length - 5} more
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </section>
          <SettingsHistory groups={["WHATSAPP"]} />
        </div>
      </div>
    </>
  );
}
