"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ORIGIN_KEY, originWay } from "@/features/shell/motion-rules";

// v1.87.0 (D-417, gap 19): a breadcrumb or "Back to …" link to a list. When
// this page was opened from that same list in this tab, the link returns to
// it with its sort, filters and page (PlaceMemory remembers the list's
// address); otherwise, and without script, it is the plain list address.
// v1.89.0 (NAV-05, D-419): with `crossList` (a page's parent crumb or its
// "Back to" link), a page opened from another users-area list (Task Summary,
// Inbox, Search …; motion-rules CROSS_LISTS) names and links that list.
// `label` is the default name; `prefix` goes before the name shown.
export function OriginLink({ href, className, children, testId, crossList = false, label, prefix = "" }: { href: string; className?: string; children?: React.ReactNode; testId?: string; crossList?: boolean; label?: string; prefix?: string }) {
  const [way, setWay] = useState<{ href: string; label: string | null }>({ href, label: null });
  useEffect(() => {
    try {
      setWay(originWay(href, window.sessionStorage.getItem(`${ORIGIN_KEY}:${window.location.pathname}`), Date.now(), crossList));
    } catch {
      setWay({ href, label: null });
    }
  }, [href, crossList]);
  const name = way.label ?? label;
  return (
    <Link href={way.href} className={className} data-testid={testId} data-origin-list={way.label ? "" : undefined}>
      {name !== undefined ? `${prefix}${name}` : children}
    </Link>
  );
}
