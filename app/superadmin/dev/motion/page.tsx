import type { Metadata } from "next";
import { requireArea } from "@/server/authorization/guards";
import { PageHeader } from "@/features/shell/PageHeader";
import { MotionPlayground } from "@/features/superadmin/MotionPlayground";

// v1.89.0 (D-420): the Motion Playground, a hidden developer page. Super Admin
// only (requireArea, like every Super Admin page: 404 for anyone else, and the
// layout's area metadata keeps this title out of that 404, D-419 / NAV-01).
// Not linked from any menu, the settings search or the sidebar.
export const metadata: Metadata = { title: "Motion playground" };
export const dynamic = "force-dynamic";

export default async function MotionPlaygroundPage() {
  await requireArea("superadmin");
  return (
    <>
      <PageHeader title="Motion playground" description="Every motion token, easing and pattern of the app, live. For developers; not linked from any menu." />
      <MotionPlayground />
    </>
  );
}
