"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { navigationHeld } from "@/features/ui/UnsavedGuard";
import { MobileSkeleton, type MobileScreen } from "@/features/mobile/MobileSkeletons";
import { HeaderSkeleton, ProjectSettingsSkeleton, ProjectSkeleton, TableSkeleton } from "@/features/ui/Skeleton";
import { afterMotion, MOTION_DELAY } from "@/features/ui/motion";

// D-233 (UI states: loading; Doherty threshold). Every page change says it
// heard the click: a thin bar slides along the top until the new page is
// there. It appears only after 150 ms (fast pages show nothing) and never
// claims a percentage: the real progress isn't known. Page skeletons stay
// only on read-only pages (KNOWN_ISSUES V6-D06), so this covers the rest.
// v1.44.1 (owner): on phones, a page change also lays the new screen's
// skeleton over the content until it arrives. It is drawn here, not by
// route loading.tsx files, because those turn a later notFound() into a 200
// and sometimes skip the refresh after an action (KNOWN_ISSUES V6-D06,
// tests/ui/loading-guard.test.ts); this only runs on a page change. Pages
// that already have a reviewed loading.tsx (Help, Profile, New) keep it.
const ROUTE_LOADERS = [/^\/users\/new$/, /^\/users\/(help|profile)(\/|$)/];
const SCREENS: [RegExp, MobileScreen][] = [
  [/^\/users$/, "home"],
  [/^\/users\/approvals$/, "approvals"],
  [/^\/users\/work\/my-tasks$/, "tasks"],
  [/^\/users\/inbox$/, "inbox"],
  [/^\/users\/more$/, "more"],
  [/^\/users\/requests\/\d+$/, "request"],
  [/^\/users\/tasks\/\d+$/, "task"],
];
// v1.72.0 (D-387, COMPONENT_SPECS §8): on a wide screen, opening a project or
// its settings lays that page's skeleton (header, tabs, toolbar, rows; or the
// section list and cards) over the content until the page arrives.
// v1.80.0 (D-407, motion review point 8): the request, task, ticket and
// meeting lists (and the Super Admin's logs) get a table-shaped skeleton on a
// wide screen too, like the phone. Same mechanism: no route loading.tsx
// (D-214's notFound() safety rule).
const TABLE_PAGES = [
  /^\/users\/(queue|queue\/sent-back|requests|approved|approved-by-me|collaborating|search|inbox|tasks|tickets|meetings|meetings\/follow-ups)$/,
  /^\/users\/work\/search$/,
  /^\/admin\/(requests|users|setup\/notifications|setup\/budgets|insights\/workload)$/, // v1.85.0 (D-412): the moved Admin lists
  /^\/superadmin\/(monitoring\/(audit|deliveries|jobs)|security\/sign-in-history|data\/danger-zone\/requests)$/, // v1.84.0 (D-411): the moved Super Admin lists
];
export function desktopSkeletonFor(pathname: string): "project" | "settings" | "table" | null {
  if (/^\/users\/work\/projects\/\d+$/.test(pathname)) return "project";
  if (/^\/users\/work\/projects\/\d+\/settings$/.test(pathname)) return "settings";
  if (TABLE_PAGES.some((pattern) => pattern.test(pathname))) return "table";
  return null;
}

// v1.80.0 (D-407, point 6): while only the query changes (a sort, a page, a
// tab or a quick filter on the same screen), <html data-nav-pending> dims the
// table being replaced to 60 % (globals.css) until the new one arrives.
export const NAV_PENDING_ATTR = "data-nav-pending";

export function skeletonFor(pathname: string): MobileScreen | null {
  if (!/^\/users(\/|$)/.test(pathname) || ROUTE_LOADERS.some((pattern) => pattern.test(pathname))) return null;
  return SCREENS.find(([pattern]) => pattern.test(pathname))?.[1] ?? "page";
}

export function NavigationProgress({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [started, setStarted] = useState<number | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const routeKey = `${pathname}?${search.toString()}`;

  // v1.89.0 (D-420, inventory row 2): when a skeleton was on screen, the page
  // that replaces it fades in (fast, opacity only) instead of swapping abruptly.
  const skeletonShown = useRef(false);
  useEffect(() => {
    setStarted(null);
    setVisible(false);
    if (!skeletonShown.current) return;
    skeletonShown.current = false;
    const root = document.documentElement;
    root.setAttribute("data-nav-reveal", "");
    return afterMotion("menu", () => root.removeAttribute("data-nav-reveal"));
  }, [routeKey]);

  // Same page, new query: dim the table (only while it is loading).
  const samePage = started !== null && target === null;
  useEffect(() => {
    if (!samePage) return;
    document.documentElement.setAttribute(NAV_PENDING_ATTR, "");
    return () => document.documentElement.removeAttribute(NAV_PENDING_ATTR);
  }, [samePage]);

  useEffect(() => {
    if (started === null) return;
    const show = window.setTimeout(() => setVisible(true), MOTION_DELAY.loader);
    // A click that didn't change the page doesn't leave the bar running.
    const giveUp = window.setTimeout(() => setStarted(null), 15_000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(giveUp);
    };
  }, [started]);

  useEffect(() => {
    // Seen on the way down (capture); a click the unsaved-changes guard held
    // back ("Leave without saving?") doesn't count.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      const path = url.pathname === window.location.pathname ? null : url.pathname;
      window.setTimeout(() => {
        if (navigationHeld(event)) return;
        setTarget(path);
        setStarted(Date.now());
      }, 0);
    };
    const onPop = () => {
      setTarget(null);
      setStarted(Date.now());
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  if (!visible || started === null) return null;
  const screen = mobile && target && target !== pathname ? skeletonFor(target) : null;
  const wide = !mobile && target && target !== pathname ? desktopSkeletonFor(target) : null;
  if (wide || screen) skeletonShown.current = true;
  return (
    <>
      {wide && <DesktopSkeleton kind={wide} />}
      {screen && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] top-[calc(var(--header-h)+env(safe-area-inset-top))] z-[calc(var(--z-header)-1)] overflow-hidden bg-[color:var(--m-bg)] px-4 pt-4" data-testid="nav-skeleton">
          <MobileSkeleton screen={screen} label="Loading the page…" />
        </div>
      )}
      <NavBar />
    </>
  );
}

// Laid exactly over the page's <main> (below the top bar, beside the sidebar).
function DesktopSkeleton({ kind }: { kind: "project" | "settings" | "table" }) {
  const [box, setBox] = useState<React.CSSProperties | null>(null);
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const top = Math.max(rect.top, 0);
    setBox({ top, left: rect.left, width: rect.width, height: Math.max(0, window.innerHeight - top) });
  }, []);
  if (!box) return null;
  return (
    <div className="fixed z-[calc(var(--z-header)-1)] overflow-hidden bg-page px-4 pt-6 sm:px-6 lg:px-8" style={box} data-testid="nav-skeleton">
      {kind === "project" ? (
        <ProjectSkeleton />
      ) : kind === "settings" ? (
        <ProjectSettingsSkeleton />
      ) : (
        <div role="status" aria-label="Loading the list…">
          <HeaderSkeleton actions />
          <TableSkeleton rows={8} columns={5} />
        </div>
      )}
    </div>
  );
}

function NavBar() {
  return (
    <div role="progressbar" aria-label="Loading the page" aria-busy="true" data-testid="nav-progress" className="fixed inset-x-0 top-0 z-palette h-0.5 overflow-hidden bg-primary-50">
      <div className="loader-bar h-full w-1/3 bg-primary-solid" />
    </div>
  );
}
