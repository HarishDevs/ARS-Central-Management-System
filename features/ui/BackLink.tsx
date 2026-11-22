"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { movedInApp } from "@/features/shell/NavMemory";

// v1.72.1 (D-395, QA F-13): "Back" for pages reached from many places (a
// person's card). It goes back in the browser when the person came from a
// page of this app, else to `fallback`. A real link, so it works without
// script and opens in a new tab like any other.
export function BackLink({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      className="mb-3 inline-flex items-center gap-1 text-label text-ink-muted hover:text-ink hover:underline"
      data-testid="back-link"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        // Only when this tab has moved between the app's pages (NavMemory) and has somewhere to go back to.
        if (movedInApp() && window.history.length > 1) {
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
