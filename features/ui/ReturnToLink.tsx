import Link from "next/link";
import type { ReturnTo } from "@/lib/nav/return-to";

// v1.89.0 (NAV-04, D-419): "← Back to Admin → Records" on a record's full page
// opened from another area's list (server/authorization/return-to.ts decides).
export function ReturnToLink({ to, className = "link text-label" }: { to: ReturnTo; className?: string }) {
  return (
    <Link href={to.href} className={className} data-testid="return-to">
      ← Back to {to.label}
    </Link>
  );
}
