"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// v1.72.1 (D-395, QA F-13): remembers, for this browser tab only, that the
// person has moved between pages of the app, so BackLink can go back in the
// browser (keeping the list's filters and scroll) instead of to a fixed page.
// Session storage: per tab, gone when the tab closes; only page addresses.
export const NAV_MEMORY_KEY = "ars.nav.moves";

export function NavMemory() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const last = window.sessionStorage.getItem(`${NAV_MEMORY_KEY}.last`);
      if (last && last !== pathname) window.sessionStorage.setItem(NAV_MEMORY_KEY, "1");
      window.sessionStorage.setItem(`${NAV_MEMORY_KEY}.last`, pathname);
    } catch {
      // storage off: BackLink uses its fixed page
    }
  }, [pathname]);
  return null;
}

export function movedInApp(): boolean {
  try {
    return window.sessionStorage.getItem(NAV_MEMORY_KEY) === "1";
  } catch {
    return false;
  }
}
