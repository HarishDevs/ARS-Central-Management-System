import { requireArea } from "@/server/authorization/guards";
import { areaMetadata } from "@/server/authorization/area-metadata";
import { AppShell } from "@/features/shell/AppShell";
import { after } from "next/server";
import { checkJobRunnerStopped } from "@/server/ops/alerts";
import { SUPERADMIN_NAV } from "@/server/panels/superadmin-nav";
import { settingsIndexFor } from "@/server/panels/settings-index";

export const dynamic = "force-dynamic";

// v1.89.0 (NAV-01, D-419): someone who may not open this area (or this page)
// gets the plain app name as the title, like an unknown address: a page's own
// title is never sent with its 404.
export function generateMetadata() {
  return areaMetadata("superadmin");
}

// Super Admin only (itadmin@, D-039): providers, security, integrations,
// system health, audit export, break-glass. 404 for everyone else.
// v1.84.0 (D-411, owner's redesign): five groups (Health, Connections,
// Security & access, Data, Monitoring); old addresses redirect
// (lib/routing/panel-redirects.ts).
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireArea("superadmin");
  // A5: a stopped job runner is noticed when IT opens a page (after it renders).
  after(() => checkJobRunnerStopped().then(() => undefined));
  return (
    <AppShell area="superadmin" user={user} nav={[...SUPERADMIN_NAV]} settingsIndex={await settingsIndexFor(user)}>
      {children}
    </AppShell>
  );
}
