import type { Metadata } from "next";
import Link from "next/link";
import { PowerOff } from "lucide-react";
import { requireArea } from "@/server/authorization/guards";
import { switchedOffLabel } from "@/features/shell/switched-off";

export const metadata: Metadata = { title: "Switched off" };

// v1.72.1 (D-395, QA F-04): where a page of a switched-off feature lands
// (server/settings/feature-guard.ts), instead of "page not found".
export default async function SwitchedOffPage({ searchParams }: { searchParams: Promise<{ feature?: string }> }) {
  await requireArea("users");
  const label = switchedOffLabel((await searchParams).feature);
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-12 text-center" data-testid="switched-off">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
        <PowerOff className="h-6 w-6" />
      </span>
      <h1 className="text-title font-semibold">{label ? `${label} is switched off` : "This part is switched off"}</h1>
      <p className="max-w-md text-ink-muted">IT has switched this part of the app off for now. Your data in it is kept and comes back when it is switched on again.</p>
      <p className="max-w-md text-label text-ink-muted">If you need it for your work, ask IT.</p>
      <Link href="/users" className="btn-primary btn-compact">
        Go to Home
      </Link>
    </div>
  );
}
