import Link from "next/link";
import { CheckSquare, CircleCheck } from "lucide-react";
import { LinkPending } from "@/features/ui/PendingLink";
import { COLLAB_TAB_LABEL, collabTabHref, type CollabTab } from "@/server/collaborating/tabs";

const ICON = { approvals: CheckSquare, tasks: CircleCheck } as const;

// v1.91.0 (D-433): one tab per module the person collaborates in, each with
// how many items it holds in all. The same look as the request lists'
// Raised by me / Shared with me tabs (OwnershipTabs).
export function CollaboratingTabs({ current, tabs, counts }: { current: CollabTab; tabs: readonly CollabTab[]; counts: Partial<Record<CollabTab, number>> }) {
  return (
    <nav aria-label="Collaborating in" className="mb-4 border-b border-line" data-testid="collab-tabs">
      <ul className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const active = current === tab;
          const Icon = ICON[tab];
          return (
            <li key={tab}>
              <Link
                href={collabTabHref(tab)}
                aria-current={active ? "page" : undefined}
                data-testid={`collab-tab-${tab}`}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-label ${active ? "border-primary-600 font-semibold text-primary-700" : "border-transparent text-ink-muted hover:text-ink"}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {COLLAB_TAB_LABEL[tab]}
                <span className={`rounded-full px-2 py-0.5 text-caption tabular-nums ${active ? "bg-primary-50 text-primary-700" : "bg-surface-muted text-ink-muted"}`} data-testid={`collab-count-${tab}`}>
                  {(counts[tab] ?? 0).toLocaleString("en-IN")}
                </span>
                <LinkPending />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
