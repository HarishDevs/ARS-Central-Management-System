import "server-only";
import { redirect } from "next/navigation";
import { featureOn, type Feature } from "@/server/settings/features";
import { switchedOffHref } from "@/features/shell/switched-off";

// v1.72.1 (D-395, QA F-04): a page of a feature IT has switched off opens a
// plain "switched off" screen instead of the generic "page not found". It
// names the feature only (never a record), so nothing private is confirmed.
export async function requireFeature(feature: Feature, user: { roles: readonly string[] }): Promise<void> {
  if (!(await featureOn(feature, user))) redirect(switchedOffHref(feature));
}
