import type { Metadata } from "next";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { ConnectionStatus } from "@/features/superadmin/ConnectionStatus";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";
import { PushKeysPanel } from "@/features/superadmin/PushKeysPanel";
import { countAllActiveDevices } from "@/lib/db/repositories/push.repository";
import { getSettingValue } from "@/server/settings/values";

export const metadata: Metadata = { title: "Phone & desktop notifications" };
export const dynamic = "force-dynamic";

// v1.84.0 (D-411, owner's redesign): Connections → Phone & desktop
// notifications (Web Push, D-252). Status, the settings and Generate keys together.
export default async function PushConnectionPage() {
  await requireArea("superadmin");
  const [publicKey, devices] = await Promise.all([getSettingValue("push.vapid_public_key").catch(() => null), countAllActiveDevices().catch(() => 0)]);
  return (
    <>
      <PageHeader title="Phone & desktop notifications" description="Web Push to the devices people register in Profile → App & devices. One key pair for the whole app, made here and never typed; the private key is stored encrypted." />
      <ConnectionStatus keys={["push"]} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsGroupSection group="PUSH" testId="settings-push" />
        <div className="space-y-6">
          <PushKeysPanel hasKeys={Boolean(publicKey)} devices={devices} />
          <SettingsHistory groups={["PUSH"]} />
        </div>
      </div>
    </>
  );
}
