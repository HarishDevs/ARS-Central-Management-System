"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavIcon, SectionIcon } from "@/features/shell/nav-icons";
import { BrandLockup } from "@/features/ui/Brand";
import { CreateMenu } from "@/features/shell/CreateMenu";
import { SIDEBAR_COOKIE, SIDEBAR_WIDTH_COOKIE, TABLET_MAX_WIDTH, TABLET_MIN_WIDTH } from "@/features/shell/sidebar-cookie";
import { MOTION_DELAY, MOTION_DURATION } from "@/features/ui/motion";

// D-229 (owner: "make the sidebar collapsible like Asana for the whole
// Application"): ☰ at the top folds the sidebar into a narrow rail of icons
// with small labels (Asana's), and opens it again. Kept in a cookie so the
// server draws the right width on the next page (no jump). A group's icon in
// the rail opens the sidebar with that group open.
const GROUPS_KEY = "ars.nav.groups"; // SideNav's remembered open groups

export type RailEntry = { kind: "item"; href: string; label: string } | { kind: "group"; section: string; href: string; label: string };

export function SidebarFrame({
  initialCollapsed,
  savedChoice = false,
  homeHref,
  homeLabel,
  rail,
  create,
  children,
}: {
  initialCollapsed: boolean | null;
  savedChoice?: boolean;
  homeHref: string;
  homeLabel: string;
  rail: RailEntry[];
  create: { approval: boolean; task: boolean; project?: boolean; portfolio?: boolean; information: boolean; meeting?: boolean; ticket?: boolean } | null;
  children: React.ReactNode;
}) {
  // v1.89.0 (D-421, UIQA-RESP-02): until the person folds or opens the
  // sidebar themselves, it follows the window: the 72 px rail on a tablet
  // (768-1279 px), open from 1280. The width class goes in a cookie so the
  // server draws the same next time. `null` = the server can't know yet (a
  // device's first page): both are drawn and CSS shows the right one at the
  // first paint (no layout shift), until the effect below picks one.
  const [collapsed, setCollapsed] = useState<boolean | null>(initialCollapsed);
  const [saved, setSaved] = useState(savedChoice);
  useEffect(() => {
    if (saved) return;
    const tablet = window.matchMedia(`(min-width: ${TABLET_MIN_WIDTH}px) and (max-width: ${TABLET_MAX_WIDTH + 0.98}px)`);
    const follow = () => {
      document.cookie = `${SIDEBAR_WIDTH_COOKIE}=${tablet.matches ? "tablet" : "wide"}; path=/; max-age=31536000; samesite=lax`;
      setCollapsed(tablet.matches);
    };
    follow();
    tablet.addEventListener("change", follow);
    return () => tablet.removeEventListener("change", follow);
  }, [saved]);
  // v1.87.0 (D-417, audit gaps 3–7): right after a toggle the labels fade and
  // slide in (open) or the rail's items fade in (folded); the state is kept
  // in the cookie as before.
  // v1.89.0 (D-420, UIQA-MOT-03): the width no longer animates (it laid the
  // main column out again on every frame and the two moved by different
  // amounts). The sidebar and the page take their new width in one step, and
  // the labels or rail items fade in at the same time (standard, transform and
  // opacity only), so the content and the sidebar move together.
  const [justToggled, setJustToggled] = useState(false);
  useEffect(() => {
    if (!justToggled) return;
    const timer = window.setTimeout(() => setJustToggled(false), MOTION_DURATION.standard + MOTION_DURATION.instant);
    return () => window.clearTimeout(timer);
  }, [justToggled]);
  // The folded rail's tooltips: one small label beside the item (fixed, so
  // the rail's own scrolling can't clip it), after 300 ms on hover or focus.
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const tipTimer = useRef(0);
  const showTip = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
    window.clearTimeout(tipTimer.current);
    if (!item) return setTip(null);
    tipTimer.current = window.setTimeout(() => {
      const box = item.getBoundingClientRect();
      setTip({ text: item.dataset.tip ?? "", top: box.top + box.height / 2, left: box.right + 8 });
    }, MOTION_DELAY.tooltip);
  };
  const hideTip = () => {
    window.clearTimeout(tipTimer.current);
    setTip(null);
  };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const pathname = usePathname();
  const set = (value: boolean) => {
    hideTip();
    setJustToggled(true);
    setSaved(true);
    setCollapsed(value);
    document.cookie = `${SIDEBAR_COOKIE}=${value ? "rail" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };
  const openGroup = (section: string) => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? "{}") as Record<string, boolean>;
      window.localStorage.setItem(GROUPS_KEY, JSON.stringify({ ...stored, [section]: true }));
    } catch {
      // storage blocked: the group opens when its page is shown
    }
    set(false);
  };
  const here = (href: string) => pathname === href || (href.split("/").length > 2 && pathname.startsWith(`${href}/`));
  // The first page on a device (collapsed === null): the rail below xl (1280), open from xl.
  const auto = collapsed === null;

  return (
    <aside
      className={`hidden shrink-0 flex-col border-r border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:self-start ${auto ? "w-rail xl:w-sidebar" : collapsed ? "w-rail" : "w-sidebar"}`}
      data-testid="sidebar"
      data-collapsed={collapsed ? "true" : undefined}
      data-sidebar-auto={auto ? "" : undefined}
      data-just-toggled={justToggled ? "" : undefined}
    >
      <div className={`flex h-topbar shrink-0 items-center gap-2 border-b border-line ${auto ? "justify-center px-2 xl:justify-start xl:px-3" : collapsed ? "justify-center px-2" : "px-3"}`}>
        <button
          type="button"
          onClick={() => set(!collapsed)}
          aria-label={collapsed ? "Open the sidebar" : "Collapse the sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Open the sidebar" : "Collapse the sidebar"}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted hover:text-ink"
          data-testid="sidebar-toggle"
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
        {!collapsed && (
          // WEB-17 (v1.10.0): the logo goes to this space's first page.
          <Link href={homeHref} aria-label={homeLabel} className={`rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${auto ? "hidden xl:inline-flex" : ""}`}>
            <BrandLockup size="sm" subtitle={false} />
          </Link>
        )}
      </div>
      {collapsed !== false && (
        <nav aria-label="Main" className={`flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden px-1 py-3 ${auto ? "xl:hidden" : ""}`} data-testid="sidebar-rail" data-just-toggled={justToggled ? "" : undefined} onPointerOver={(event) => showTip(event.target)} onPointerLeave={hideTip} onFocus={(event) => showTip(event.target)} onBlur={hideTip}>
          {create && <CreateMenu {...create} compact />}
          {rail.map((entry) => {
            const active = entry.kind === "item" ? here(entry.href) : false;
            const body = (
              <>
                {entry.kind === "item" ? <NavIcon href={entry.href} className="h-5 w-5" /> : <SectionIcon section={entry.section} className="h-5 w-5" />}
                <span className="line-clamp-2 w-full break-words text-center text-[length:calc(10px*var(--text-scale,1))] leading-tight [hyphens:auto]">{entry.label}</span>
              </>
            );
                        const style = `flex w-full flex-col items-center gap-1 rounded-md px-1 py-1.5 ${active ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:bg-surface-muted hover:text-ink"}`;
            return entry.kind === "item" ? (
              <Link key={entry.href} href={entry.href} aria-current={active ? "page" : undefined} data-tip={entry.label} className={style}>
                {body}
              </Link>
            ) : (
              <button key={entry.section} type="button" data-tip={`${entry.label}: open the sidebar`} onClick={() => openGroup(entry.section)} className={style}>
                {body}
              </button>
            );
          })}
          {tip && (
            <span role="tooltip" className="rail-tooltip" style={{ top: tip.top, left: tip.left }} data-testid="rail-tooltip">
              {tip.text}
            </span>
          )}
        </nav>
      )}
      {collapsed === false && children}
      {auto && <div className="hidden min-h-0 flex-1 flex-col xl:flex">{children}</div>}
    </aside>
  );
}
