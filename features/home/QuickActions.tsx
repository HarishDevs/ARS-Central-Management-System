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

export function QuickActions({ items, testId }: { items: QuickAction[]; testId: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Quick actions" className="mb-5 flex flex-wrap gap-2" data-testid={testId}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={`${item.primary ? "btn-primary" : "btn-secondary"} btn-compact inline-flex items-center gap-1.5`}>
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
