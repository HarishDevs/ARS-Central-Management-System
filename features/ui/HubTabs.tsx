"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/features/shell/nav-icons";

// v1.85.0 (D-412, owner's Admin redesign): the tabs of a hub (Insights).
// Links, so each tab has its own address; the most specific match is lit.
// Scrolls sideways on a phone instead of wrapping into many rows.
export function HubTabs({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const active = tabs.filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={label} className="-mx-1 mb-6 overflow-x-auto border-b border-line" data-testid="hub-tabs">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((tab) => {
          const current = tab.href === active;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={`-mb-px inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-label ${current ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                <NavIcon href={tab.href} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
