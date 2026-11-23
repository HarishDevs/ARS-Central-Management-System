"use client";

import { useLayoutEffect, useRef } from "react";

// v1.87.0 (D-417, audit gap 5): a bar beside the current page in the
// sidebar that moves to the new page (transform only, 220 ms; at once on the
// first draw and under reduced motion). The page's own highlight stays as it
// was; this only shows where the person went. Hidden when the current page
// is inside a closed group. Decorative (aria-hidden): aria-current says it.
export function NavIndicator({ watch }: { watch: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const element = bar.current;
    const nav = element?.parentElement;
    if (!element || !nav) return;
    const place = () => {
      const link = Array.from(nav.querySelectorAll<HTMLElement>('a[aria-current="page"]')).find((candidate) => candidate.offsetParent !== null);
      if (!link) {
        element.setAttribute("data-hidden", "");
        return;
      }
      const top = link.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
      if (!placed.current) element.setAttribute("data-instant", "");
      element.style.height = `${link.offsetHeight}px`;
      element.style.transform = `translateY(${Math.round(top)}px)`;
      element.removeAttribute("data-hidden");
      if (!placed.current) {
        placed.current = true;
        requestAnimationFrame(() => element.removeAttribute("data-instant"));
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [watch]);
  return <span ref={bar} aria-hidden="true" className="nav-indicator" data-hidden="" data-testid="nav-indicator" />;
}
