import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/features/shell/PageHeader";
import { requireArea } from "@/server/authorization/guards";
import { SettingsGroupSection, SettingsHistory } from "@/features/superadmin/SettingsGroupSection";

export const metadata: Metadata = { title: "Sign-in security" };
export const dynamic = "force-dynamic";

// v1.84.0 (D-411, owner's redesign): Security & access → Sign-in security
// (codes, lockout and device limits), on its own page with one Save.
export default async function SignInSecurityPage() {
  await requireArea("superadmin");
  return (
    <>
      <PageHeader title="Sign-in security" description="WhatsApp code, lockout and device limits for User ID sign-in. Google sign-in has no code (fixed decision). Each value has safe minimum and maximum bounds; every change is recorded." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsGroupSection group="AUTHENTICATION" testId="settings-sign-in" />
        <div className="space-y-6">
          <section className="card px-5 py-4 text-label">
            <h2 className="font-semibold">Related</h2>
            <ul className="mt-2 space-y-1">
              <li>
                <Link className="link" href="/superadmin/security/sign-in-history">
                  Sign-in history
                </Link>
              </li>
              <li>
                <Link className="link" href="/superadmin/connections/google">
                  Google sign-in status
                </Link>
              </li>
            </ul>
          </section>
          <SettingsHistory groups={["AUTHENTICATION"]} />
        </div>
      </div>
    </>
  );
}
