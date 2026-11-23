import Link from "next/link";
import { WidgetsToolbarSlot } from "@/features/home/WidgetsSlot";

// v1.77.1 (owner, 22 Nov 2026: "all necessary basic Quick actions in Approvals
// and Meetings Overview as well"): the same row of quick actions the Task
// Management overview has. The first item is the create action (primary); a
// page the person can't open is left out by the caller (isHiddenHref).
// v1.86.0 (H-01): all three overviews draw this one row (My Work had its own
// copy, so React replaced the widget slot on an overview switch). `node`
// draws a ready-made control in the item's place (Create task, a coming-soon chip).
export interface QuickAction {
  href: string; // also the item's key
  label: string;
  icon?: React.ReactNode;
  primary?: boolean;
  node?: React.ReactNode;
}

// v1.79.0 (D-406): `widgets` adds the slot at the right end of the row where
// the overview's widget board draws + Add widgets and Customise (a portal,
// HomeWidgets), as on My Work since v1.77.1.
export { WIDGETS_TOOLBAR_SLOT } from "@/features/home/WidgetsSlot";

export function QuickActions({ items, testId, widgets = false }: { items: QuickAction[]; testId: string; widgets?: boolean }) {
  if (!items.length && !widgets) return null;
  return (
    <nav aria-label="Quick actions" className="mb-5 flex flex-wrap gap-2" data-testid={testId}>
      {items.map((item) =>
        item.node ? (
          <span key={item.href} className="contents">
            {item.node}
          </span>
        ) : (
          <Link key={item.href} href={item.href} className={`${item.primary ? "btn-primary" : "btn-secondary"} btn-compact inline-flex items-center gap-1.5`}>
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        ),
      )}
      {widgets && <WidgetsToolbarSlot />}
    </nav>
  );
}
