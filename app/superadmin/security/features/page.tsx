import type { Metadata } from "next";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";

export const metadata: Metadata = { title: "Feature switches" };
export const dynamic = "force-dynamic";

// v1.84.0 (D-411, owner's redesign): Security & access → Feature switches,
// on their own page (they were one group among eleven on Providers &
// security). On, Off, or IT team only; switching off hides a feature and
// removes no data. The server checks every switch (featureOn) as before.
export default async function FeatureSwitchesPage() {
  await requireArea("superadmin");
  return (
    <>
      <PageHeader title="Feature switches" description="Turn features on, off, or on for the IT team only (a trial before everyone). Switching off hides a feature everywhere and its pages refuse; no data is removed. Every change is recorded." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsGroupSection group="FEATURES" testId="settings-features" />
        <SettingsHistory groups={["FEATURES"]} limit={15} />
      </div>
    </>
  );
}
