"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { NavIcon } from "@/features/shell/nav-icons";
import { SettingsSearch, type SettingsIndexEntry } from "@/features/ui/SettingsSearch";

// v1.84.0 (D-411, owner's redesign): the settings layout (after the Astryx
// settings-sidebar template, MIT, structure only). A section list on the
// left and the chosen section on the right; Search settings above the list.
// Each section keeps its own form with one Save and the unsaved guard
// (SettingsGroupForm / UnsavedGuard), so leaving a section with changes asks.
// On a phone the hub page (base) lists the sections and each one opens as its
// own page with a way back to the list.
export interface SettingsSection {
  href: string;
  label: string;
  group: string;
  description?: string;
}

const isUnder = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function SettingsLayout({ base, title, sections, index, children }: { base: string; title: string; sections: SettingsSection[]; index: readonly SettingsIndexEntry[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = sections.filter((section) => isUnder(pathname, section.href)).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
  const atHub = pathname === base;
  const groups: { group: string; items: SettingsSection[] }[] = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last?.group === section.group) last.items.push(section);
    else groups.push({ group: section.group, items: [section] });
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]" data-testid="settings-layout">
      <nav aria-label={`${title} sections`} className="hidden lg:sticky lg:top-20 lg:block lg:self-start">
        <SettingsSearch index={index} />
        {groups.map((block) => (
          <div key={block.group} className="mb-3">
            <p className="px-3 pb-1 text-caption font-semibold text-ink-faint">{block.group}</p>
            <ul className="space-y-0.5">
              {block.items.map((section) => {
                const current = active?.href === section.href;
                return (
                  <li key={section.href}>
                    <Link
                      href={section.href}
                      aria-current={current ? "page" : undefined}
                      className={`flex min-h-8 items-center gap-2 rounded-md px-3 py-1 text-label ${current ? "bg-primary-50 font-semibold text-primary-700" : "text-ink hover:bg-surface-muted"}`}
                      data-testid="settings-section-link"
                    >
                      <NavIcon href={section.href} />
                      <span className="flex-1">{section.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0">
        {!atHub && (
          <Link href={base} className="mb-3 inline-flex min-h-8 items-center gap-1 text-label text-ink-muted hover:text-ink lg:hidden" data-testid="settings-back">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" /> All {title.toLowerCase()} sections
          </Link>
        )}
        {children}
      </div>
    </div>
  );
}
