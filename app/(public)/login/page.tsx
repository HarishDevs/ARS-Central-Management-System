import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/features/auth/components/AuthLayout";
import { SignInPanel } from "@/features/auth/components/SignInPanel";
import { getCurrentSession } from "@/server/auth/session";
import { landingFor, safeNextPath } from "@/lib/http/safe-next";
import { evaluateAreaAccess } from "@/server/authorization/policy";

export const metadata: Metadata = { title: "Sign in" };


export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const raw = (await searchParams).next;
  const next = safeNextPath(raw);
  // v1.89.0 (NAV-07, D-419): signed in (also the step right after signing in,
  // SignInPanel): a ?next= in an area this person can't open lands on their
  // home page, not on a 404. The page opened still runs its own checks.
  const session = await getCurrentSession().catch(() => null);
  if (session) redirect(landingFor(raw, (area) => evaluateAreaAccess(session.user, area).allowed));

  return (
    <AuthLayout>
      <SignInPanel nextPath={next} />
    </AuthLayout>
  );
}
