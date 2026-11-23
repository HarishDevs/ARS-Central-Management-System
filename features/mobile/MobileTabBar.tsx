"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, CircleCheck, Home, Inbox, Menu } from "lucide-react";

// v1.43.0 (owner's mobile brief §2): five places at the bottom, in thumb
// reach: Home, Approvals, Tasks, Inbox, More. A tab the person can't open is
// left out; counts come from the server (their own work only).
const TABS = [
  { key: "home", href: "/users", label: "Home", icon: Home, match: (path: string) => path === "/users" },
  {
    key: "approvals",
    href: "/users/approvals",
    label: "Approvals",
    icon: CheckSquare,
    match: (path: string) => /^\/users\/(approvals|queue|requests|approved|approved-by-me|collaborating|new|custom|search)(\/|$)/.test(path),
  },
  { key: "tasks", href: "/users/work/my-tasks", label: "My tasks", icon: CircleCheck, match: (path: string) => /^\/users\/(work|tasks)(\/|$)/.test(path) },
  { key: "inbox", href: "/users/inbox", label: "Inbox", icon: Inbox, match: (path: string) => /^\/users\/(inbox|notifications)(\/|$)/.test(path) },
  { key: "more", href: "/users/more", label: "More", icon: Menu, match: (path: string) => /^\/users\/(more|menu|information|meetings|tickets|calendar|analytics|ai|reports|profile|help|delegation|security|people|switched-off)(\/|$)/.test(path) },
] as const;

export function MobileTabBar({ waiting, unread, hidden }: { waiting: number; unread: number; hidden: string[] }) {
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => !hidden.includes(tab.key));
  return (
    <nav aria-label="Main" className="mob-tabbar fixed inset-x-0 bottom-0 z-header border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" data-testid="mobile-tabbar">
      <ul className="grid h-16" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const active = tab.match(pathname);
          const count = tab.key === "approvals" ? waiting : tab.key === "inbox" ? unread : 0;
          const Icon = tab.icon;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-0.5 text-[length:calc(12px*var(--text-scale,1))] font-medium ${active ? "text-ink" : "text-ink-muted"}`}
              >
                {/* v1.45.0 (Asana reference): the open tab sits in a pill and says its name. */}
                {/* v1.89.0 (D-420): the pill grows by transform and fades in (it animated width). */}
                <span aria-hidden="true" className="relative grid h-8 w-14 place-items-center">
                  <span className={`absolute inset-0 rounded-full bg-surface-muted transition-[transform,opacity] duration-fast ease-standard ${active ? "scale-x-100 opacity-100" : "scale-x-75 opacity-0"}`} />
                  <Icon className="relative h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 1.8} />
                </span>
                <span className={active ? "" : "sr-only"}>{tab.label}</span>
                {count > 0 && (
                  <span className="absolute left-1/2 top-1.5 ml-2.5 min-w-[18px] rounded-full bg-[color:var(--m-red)] px-1 text-center text-[length:calc(10px*var(--text-scale,1))] font-bold leading-[18px] text-white">
                    {count > 99 ? "99+" : count}
                    <span className="sr-only"> {tab.key === "inbox" ? "unread" : "waiting"}</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
