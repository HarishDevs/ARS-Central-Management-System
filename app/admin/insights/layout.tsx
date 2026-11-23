import { requireArea } from "@/server/authorization/guards";
import { HubTabs } from "@/features/ui/HubTabs";
import { insightsTabs } from "@/server/panels/admin-hubs";

export const dynamic = "force-dynamic";

// v1.85.0 (D-412, owner's Admin redesign): one Insights hub instead of six
// places. Tabs: Summary, Dashboards, Analytics, Reports, Workload (with
// reassign) and AI analytics; each tab keeps its own switch and page-access
// key, and each page still checks the Admin area itself.
export default async function InsightsLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireArea("admin");
  return (
    <>
      <HubTabs label="Insights" tabs={await insightsTabs(user)} />
      {children}
    </>
  );
}
