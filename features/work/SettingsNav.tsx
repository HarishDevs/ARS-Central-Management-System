"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Menu } from "@/features/ui/Menu";

// v1.72.0 (D-387, spec PM §3.11 "Project settings" tabs, PC §1): the project
// settings page's sections in the spec's order, grouped (Project settings,
// Sharing, Customize, More). Wide screens: a sticky list beside the page,
// the section in view marked. Phones: one "Jump to" dropdown.
export interface SettingsNavGroup {
  name: string;
  items: { id: string; label: string }[];
}

export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const ids = groups.flatMap((group) => group.items.map((item) => item.id));
    const headings = ids.map((id) => document.getElementById(id)).filter((element): element is HTMLElement => Boolean(element));
    if (!headings.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const shown = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (shown) setCurrent(shown.target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [groups]);
  const all = groups.flatMap((group) => group.items);
  const label = all.find((item) => item.id === current)?.label ?? "Sections";
  return (
    <>
      <div className="mb-4 lg:hidden">
        <Menu
          label={`Jump to a section. Now: ${label}`}
          trigger={
            <span className="inline-flex items-center gap-1">
              Jump to: {label} <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </span>
          }
          buttonClass="btn-secondary btn-compact"
          align="left"
          menuClass="w-64"
          testId="settings-jump"
          items={groups.flatMap((group) => [{ kind: "heading" as const, label: group.name }, ...group.items.map((item) => ({ label: item.label, href: `#${item.id}` }))])}
        />
      </div>
      <nav aria-label="Settings sections" className="sticky top-[5rem] hidden max-h-[calc(100vh-6rem)] overflow-y-auto lg:block" data-testid="settings-nav">
        {groups.map((group) => (
          <div key={group.name} className="mb-3">
            <p className="mb-1 px-2 text-caption font-semibold text-ink-faint">{group.name}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} aria-current={current === item.id ? "location" : undefined} className={`block rounded-md px-2 py-1.5 text-label ${current === item.id ? "bg-primary-50 font-medium text-primary-700" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
