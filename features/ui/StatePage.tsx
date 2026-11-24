import Link from "next/link";
import { Inbox, Lock, SearchX, type LucideIcon } from "lucide-react";

// v1.89.0 (D-422, UIQA-CON-16 / LAY-03 groundwork, UI unification batch 2):
// one full-page state for "not found", "no access" and "empty", inside the
// area's shell. FB-07 still holds: not found and not yours read the same, so
// a private record's existence is never confirmed (D-016). The search box is
// the area's own (requests in /users; none in the panels, which have no
// record search), and the home link is the area's home.
// The error state stays ErrorState (features/ui/States, a client component
// with Try again); the loading states stay the skeletons (features/ui/Skeleton).
const ICON: Record<"not-found" | "no-access" | "empty", LucideIcon> = { "not-found": SearchX, "no-access": Lock, empty: Inbox };

export function StatePage({
  kind,
  title,
  body,
  search,
  home,
  children,
  testId,
}: {
  kind: "not-found" | "no-access" | "empty";
  title: string;
  body: string;
  search?: { action: string; label: string; placeholder: string };
  home?: { href: string; label: string };
  children?: React.ReactNode;
  testId?: string;
}) {
  const Icon = ICON[kind];
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-12 text-center" data-state-page={kind} data-testid={testId}>
      <span aria-hidden="true" className={`flex h-12 w-12 items-center justify-center rounded-full ${kind === "no-access" ? "bg-warning-50 text-warning-600" : "bg-surface-muted text-ink-faint"}`}>
        <Icon className="h-6 w-6" />
      </span>
      <h1 className="text-page-title [overflow-wrap:anywhere]">{title}</h1>
      <p className="max-w-md text-ink-muted">{body}</p>
      {search && (
        <form action={search.action} method="get" role="search" className="flex w-full max-w-sm items-center gap-2">
          <label htmlFor="state-q" className="sr-only">
            {search.label}
          </label>
          <input id="state-q" data-search-kind="finder" name="q" type="search" placeholder={search.placeholder} className="field-input" />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
      )}
      {children}
      {home && (
        <Link href={home.href} className="link">
          {home.label}
        </Link>
      )}
    </div>
  );
}

// The words every area's not-found page uses (FB-07).
export const NOT_FOUND_TITLE = "This page isn't available";
export const NOT_FOUND_BODY = "The link may be wrong, the item may have been removed, or it may not be shared with you.";
