import type { Metadata } from "next";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";

export const metadata: Metadata = { title: "General" };
export const dynamic = "force-dynamic";

// v1.84.0 (D-411, owner's redesign): Security & access → General (the app's
// name, timezone, the maintenance notice and the other app-wide basics).
export default async function GeneralSettingsPage() {
  await requireArea("superadmin");
  return (
    <>
      <PageHeader title="General" description="The application name, timezone, the maintenance notice shown at the top of every page, and the other app-wide basics. Every change is recorded." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsGroupSection group="GENERAL" testId="settings-general" />
        <SettingsHistory groups={["GENERAL"]} />
      </div>
    </>
  );
}
