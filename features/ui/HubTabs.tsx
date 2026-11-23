"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NavIcon } from "@/features/shell/nav-icons";

// v1.85.0 (D-412, owner's Admin redesign): the tabs of a hub (Insights).
// Links, so each tab has its own address; the most specific match is lit.
// v1.86.0 (H-04, header audit): from tablet width up the tabs wrap onto a
// second row, so none is hidden. On a phone they still scroll sideways, but a
// fade at a clipped edge shows that more tabs are there, and the open tab is
// scrolled into view.
export function HubTabs({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const active = tabs.filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const scroller = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => {
      const start = box.scrollLeft > 1;
      const end = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
      setEdges((old) => (old.start === start && old.end === end ? old : { start, end }));
    };
    // Only the tab row scrolls (never the page): bring the open tab into view.
    const open = box.querySelector<HTMLElement>('[aria-current="page"]');
    if (open && box.scrollWidth > box.clientWidth) {
      const left = open.offsetLeft - box.offsetLeft;
      if (left < box.scrollLeft || left + open.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = Math.max(0, left - 24);
    }
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      box.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [active]);
  return (
    <div className="relative -mx-1 mb-6" data-testid="hub-tabs-frame" data-clip-start={edges.start ? "" : undefined} data-clip-end={edges.end ? "" : undefined}>
      <nav ref={scroller} aria-label={label} className="overflow-x-auto border-b border-line md:overflow-visible" data-testid="hub-tabs">
        <ul className="flex min-w-max gap-1 px-1 md:min-w-0 md:flex-wrap">
          {tabs.map((tab) => {
            const current = tab.href === active;
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-10 items-center gap-2 border-b-2 px-3 text-label transition-colors duration-instant ${current ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                  <NavIcon href={tab.href} />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Edge cues: decorative, the tabs stay reachable by keyboard and swipe. */}
      <span aria-hidden="true" className={`hub-tabs-cue left-0 bg-gradient-to-r ${edges.start ? "opacity-100" : "opacity-0"}`} />
      <span aria-hidden="true" className={`hub-tabs-cue right-0 bg-gradient-to-l ${edges.end ? "opacity-100" : "opacity-0"}`} />
    </div>
  );
}
