import { PendingLink } from "@/features/ui/PendingLink";

// v1.91.3 (D-437): the count and pager below a list's table, the Waiting for me layout of
// v1.91.1 (D-435 point 3) for Sent back for changes and Approved by me: "N … · page 1 of 2"
// on the left (the page part only with more than one page), ← Earlier / Later → on the right.
// Same markup and classes as Waiting for me's footer (`app/users/queue/page.tsx`).
export function ListFooter({ count, page, pages, earlierHref, laterHref, testId = "list-footer" }: { count: string; page: number; pages: number; earlierHref: string; laterHref: string; testId?: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-label" data-testid={testId}>
      <p className="text-ink-muted" role="status">
        {count}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </p>
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3">
          {page > 1 ? (
            <PendingLink href={earlierHref} className="btn-secondary btn-compact">
              ← Earlier
            </PendingLink>
          ) : null}
          {page < pages ? (
            <PendingLink href={laterHref} className="btn-secondary btn-compact">
              Later →
            </PendingLink>
          ) : null}
        </nav>
      )}
    </div>
  );
}
