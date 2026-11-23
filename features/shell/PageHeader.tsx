import { SafeText } from "@/features/ui/SafeText";
import { Hint } from "@/features/ui/Hint";
import type { LucideIcon } from "lucide-react";

// Page title (h1) and the page's primary actions in the same bar (S9-07).
// D-179: `description` (instructions) is a hover hint next to the title;
// `meta` (facts about what is shown: a record's number, the period, the live
// version) stays visible under it.
// D-257 (owner's redesign): an optional icon tile beside the title (Compact
// view only; the Classic view keeps its plain title bar).
// v1.80.0 (D-407, first-review point 4): the 48 px icon tile is gone (the
// title alone leads the page); `icon` is still accepted and ignored.
export function PageHeader({ title, description, meta, children, badge }: { title: string; description?: string; meta?: string; icon?: LucideIcon; children?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    // v1.89.0 (UIQA-LAY-01, P1): every flex child on the title's path has
    // min-w-0 (a flex item's min-width:auto was the whole unbroken word), and
    // the h1 wraps anywhere, so a pasted URL or reference wraps inside the
    // content column instead of scrolling the page sideways.
    // D-421: the title is the page-title token (24) and the bottom margin the
    // section gap (24; 16 on phones).
    <div className="mb-section flex min-w-0 flex-wrap items-center justify-between gap-4" data-tour="page-header">
      <div className="flex min-w-0 max-w-full items-center gap-3">
        <div className="min-w-0 max-w-full">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h1 className="min-w-0 max-w-full text-page-title tracking-tight [overflow-wrap:anywhere]">{typeof title === "string" ? <SafeText text={title} /> : title}</h1>
            {description && <Hint text={description} align="start" />}
            {/* v1.47.0: e.g. the request's Priority pill, beside the title. */}
            {badge}
          </div>
          {meta && (
            <p className="mt-1 max-w-3xl text-label text-ink-muted [overflow-wrap:anywhere]">
              <SafeText text={meta} />
            </p>
          )}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

// The shared empty state (UI-03); kept here so existing imports work.
export { EmptyState } from "@/features/ui/Display";
