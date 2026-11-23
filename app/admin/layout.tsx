import { requireArea } from "@/server/authorization/guards";
import { AppShell } from "@/features/shell/AppShell";
import { after } from "next/server";
import { checkJobRunnerStopped } from "@/server/ops/alerts";
import { adminNav } from "@/server/panels/admin-nav";
import { settingsIndexFor } from "@/server/panels/settings-index";

export const dynamic = "force-dynamic";

// IT team area (D-039): predefined approvals, forms, workflows, DoA,
// users and roles. The role check runs here on the server; without the
// IT_ADMIN or SUPER_ADMIN role the visitor gets a plain 404.
// v1.84.0 (D-411): the sidebar list lives in server/panels/admin-nav.ts
// (shared with Search settings).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireArea("admin");
  // A5: a stopped job runner is noticed when IT opens a page (after it renders).
  after(() => checkJobRunnerStopped().then(() => undefined));
  const nav = await adminNav(user);
  return (
    <AppShell area="admin" user={user} nav={nav} settingsIndex={await settingsIndexFor(user, { items: nav })}>
      {children}
    </AppShell>
  );
}
