import "server-only";
import type { Metadata } from "next";
import { APP_BRANDING } from "@/lib/branding";
import { getCurrentSession } from "@/server/auth/session";
import { checkPageAccess } from "@/server/authorization/page-access";
import { evaluateAreaAccess } from "@/server/authorization/policy";
import type { AppArea } from "@/types/auth";

// v1.89.0 (NAV-01, D-419): a restricted Admin or Super Admin page answers 404
// (D-016), but Next 15 resolves and streams the page's `metadata` apart from
// the page itself, so the 404 still carried the page's own title ("Audit log
// · ARS CMS"): proof that the page exists. The area layouts now decide the
// title template from the same checks as requireArea (role, then page access)
// before any page title can be used. Refused: a template without "%s", so
// every page title in the area becomes the plain app name, the same as an
// unknown address. Allowed: nothing changes (the root "%s · ARS CMS").
// The role check itself stays in requireArea (layout and every page).
export function areaTitleMetadata(allowed: boolean): Metadata {
  // `absolute` for the area's own title (a 404 thrown by the layout itself),
  // `template` for every page under it: both the plain app name.
  return allowed ? {} : { title: { absolute: APP_BRANDING.appName, template: APP_BRANDING.appName } };
}

export async function areaMetadata(area: AppArea): Promise<Metadata> {
  const session = await getCurrentSession().catch(() => null);
  if (!session || !evaluateAreaAccess(session.user, area).allowed) return areaTitleMetadata(false);
  const page = await checkPageAccess(session.user, false).catch(() => ({ ok: false }) as const);
  return areaTitleMetadata(page.ok);
}
