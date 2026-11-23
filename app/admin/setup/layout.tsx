import { requireArea } from "@/server/authorization/guards";
import { SettingsLayout } from "@/features/ui/SettingsLayout";
import { setupSections } from "@/server/panels/admin-hubs";
import { settingsIndexFor } from "@/server/panels/settings-index";

export const dynamic = "force-dynamic";

// v1.85.0 (D-412, owner's Admin redesign): one Set-up hub instead of six
// "set-up" groups: a section list on the left (Approvals, Tasks, Information,
// Ticketing, Meetings, Automation, AI) and the section on the right, with
// Search settings above the list. Each section keeps its own forms, Save and
// unsaved guard; hidden pages leave the list (and still refuse on the server).
export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireArea("admin");
  const [sections, index] = await Promise.all([setupSections(user), settingsIndexFor(user)]);
  return (
    <SettingsLayout base="/admin/setup" title="Set-up" sections={sections} index={index}>
      {children}
    </SettingsLayout>
  );
}
