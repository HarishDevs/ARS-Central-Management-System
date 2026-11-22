import Link from "next/link";

// v1.77.1 (owner, 22 Nov 2026: "all necessary basic Quick actions in Approvals
// and Meetings Overview as well"): the same row of quick actions the Task
// Management overview has. The first item is the create action (primary); a
// page the person can't open is left out by the caller (isHiddenHref).
export interface QuickAction {
  href: string;
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
}

// v1.79.0 (D-406): `widgets` adds the slot at the right end of the row where
// the overview's widget board draws + Add widgets and Customise (a portal,
// HomeWidgets), as on My Work since v1.77.1.
export const WIDGETS_TOOLBAR_SLOT = "home-widgets-toolbar-slot";

export function QuickActions({ items, testId, widgets = false }: { items: QuickAction[]; testId: string; widgets?: boolean }) {
  if (!items.length && !widgets) return null;
  return (
    <nav aria-label="Quick actions" className="mb-5 flex flex-wrap gap-2" data-testid={testId}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={`${item.primary ? "btn-primary" : "btn-secondary"} btn-compact inline-flex items-center gap-1.5`}>
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </Link>
      ))}
      {/* v1.80.0 (D-407, point 15): the slot keeps the room of + Add widgets and Customise
          (drawn after the page loads), so the row doesn't wrap late and push the page down. */}
      {widgets && <div id={WIDGETS_TOOLBAR_SLOT} className="reserve-widget-tools ml-auto flex flex-wrap items-center justify-end gap-2" />}
    </nav>
  );
}
