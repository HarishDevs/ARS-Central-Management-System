"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ORIGIN_KEY, originFor } from "@/features/shell/motion-rules";

// v1.87.0 (D-417, gap 19): a breadcrumb or "Back to …" link to a list. When
// this page was opened from that same list in this tab, the link returns to
// it with its sort, filters and page (PlaceMemory remembers the list's
// address); otherwise, and without script, it is the plain list address.
export function OriginLink({ href, className, children, testId }: { href: string; className?: string; children: React.ReactNode; testId?: string }) {
  const [to, setTo] = useState(href);
  useEffect(() => {
    try {
      setTo(originFor(href, window.sessionStorage.getItem(`${ORIGIN_KEY}:${window.location.pathname}`), Date.now()));
    } catch {
      setTo(href);
    }
  }, [href]);
  return (
    <Link href={to} className={className} data-testid={testId}>
      {children}
    </Link>
  );
}
