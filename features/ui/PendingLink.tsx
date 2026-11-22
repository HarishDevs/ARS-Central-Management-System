"use client";

import Link, { useLinkStatus } from "next/link";
import { Spinner } from "@/features/ui/Spinner";

// A link that shows it's working once clicked (QA session 14, DEF-01/04/09).
// Used where only the query changes (periods, pages, Earlier/Later).
// v1.80.0 (D-407, motion review points 6 and 7): a Next link (no full page
// reload; the list keeps its place), and the pending look comes from Next's
// own link status, so the latest click always wins. The table being replaced
// dims meanwhile (globals.css html[data-nav-pending]).
export function PendingLink({ href, className, children, scroll = false, "aria-label": ariaLabel }: { href: string; className?: string; children: React.ReactNode; scroll?: boolean; "aria-label"?: string }) {
  return (
    <Link href={href} scroll={scroll} prefetch={false} aria-label={ariaLabel} className={`inline-flex items-center gap-1.5 ${className ?? ""}`} data-testid="pending-link">
      {children}
      <LinkPending />
    </Link>
  );
}

// The spinner of the link it sits in (only while that link's page loads).
export function LinkPending({ className = "h-3.5 w-3.5" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} label="Loading" /> : null;
}

// For a link's label: dims it while its page loads (sort headers, tabs).
export function PendingLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span data-link-pending={pending || undefined} aria-busy={pending || undefined} className="inline-flex items-center gap-1">
      {children}
      {pending && <Spinner className="h-3 w-3" label="Loading" />}
    </span>
  );
}
