"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { backStaysInApp, currentTrail } from "@/features/ui/pane-close";

// v1.72.1 (D-395, QA F-13): "Back" for pages reached from many places (a
// person's card). It goes back in the browser when the person came from a
// page of this app, else to `fallback`. A real link, so it works without
// script and opens in a new tab like any other.
// v1.89.0 (NAV-08, D-419): "came from a page of this app" is the entry before
// this one (Navigation API) or else the tab's trail
// (pane-close.ts, fed by PlaceMemory), not a sticky per-tab flag, so a page
// opened from an email or another site never sends the person out of the app.
// The entry before this one in this tab, from the Navigation API (its entries
// are this site's only): its path, null when there is none, undefined when the
// browser has no Navigation API.
type NavigationLike = { currentEntry?: { index: number } | null; entries?: () => { url: string | null }[] };
function previousEntry(): string | null | undefined {
  try {
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    if (!nav?.currentEntry || typeof nav.entries !== "function") return undefined;
    const index = nav.currentEntry.index;
    if (index <= 0) return null;
    const url = nav.entries()[index - 1]?.url;
    if (!url) return null;
    const previous = new URL(url);
    return previous.origin === window.location.origin ? `${previous.pathname}${previous.search}` : null;
  } catch {
    return undefined;
  }
}

export function BackLink({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className="mb-3 inline-flex items-center gap-1 text-label text-ink-muted hover:text-ink hover:underline"
      data-testid="back-link"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        if (backStaysInApp(currentTrail(), `${window.location.pathname}${window.location.search}`, previousEntry())) {
          event.preventDefault();
          router.back();
        }
      }}
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      {label}
    </Link>
  );
}
