"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Briefcase, Star, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { sidebarMoveAction, sidebarSortAction } from "@/app/users/work/actions";
import { inside } from "@/features/ui/inside";
import { identityColor, ProjectDot, useWorkCall } from "@/features/work/client";
import { SIDEBAR_SORT_LABEL, SIDEBAR_SORTS, type SidebarList, type SidebarSort } from "@/server/work/pm-rules";

// v1.62.0 (D-368, spec NAV sidebar): Starred projects and the projects
// shared with the person's department, under the main links. Each section
// has a sort menu (Manual, A–Z, Recently opened); in Manual, Alt + ↑ / ↓ on a
// project (or its arrows) moves it, and a screen reader hears where it went.
export interface SidebarSectionView {
  list: SidebarList;
  sort: SidebarSort;
  items: { id: number; name: string; color: string }[];
}

// v1.69.0 (D-382): starred portfolios follow the starred projects (by name), and a Portfolios link.
export function WorkSidebar({ starred, departments, departmentName, portfolios = null }: { starred: SidebarSectionView; departments: SidebarSectionView; departmentName: string | null; portfolios?: { id: number; name: string; color: string }[] | null }) {
  return (
    <div className="space-y-1 px-2 pb-3" data-testid="work-sidebar">
      <ProjectSection title="Starred" icon={<Star aria-hidden="true" className="h-3 w-3" />} data={starred} empty="Star a project (☆ in its header or the project list) to keep it here." />
      {portfolios && <PortfolioLinks items={portfolios} />}
      {departmentName && <ProjectSection title={departmentName} heading="Departments" icon={<Users aria-hidden="true" className="h-3 w-3" />} data={departments} empty="No projects are shared with your department yet." />}
    </div>
  );
}

function ProjectSection({ title, heading, icon, data, empty }: { title: string; heading?: string; icon: React.ReactNode; data: SidebarSectionView; empty: string }) {
  const { call, pending } = useWorkCall();
  const pathname = usePathname();
  const [live, setLive] = useState("");
  const id = useId();
  const manual = data.sort === "MANUAL";
  const move = (projectId: number, direction: "up" | "down") =>
    void call(() => sidebarMoveAction(data.list, projectId, direction), { success: false }).then((result) => result && setLive(result.message ?? ""));
  return (
    <section aria-labelledby={`${id}-h`} className="pt-2" data-testid={`sidebar-${data.list.toLowerCase()}`}>
      {heading && <p className="px-2 pb-0.5 text-caption font-semibold uppercase tracking-wide text-ink-faint">{heading}</p>}
      <div className="flex items-center gap-1 px-2">
        <h2 id={`${id}-h`} className="flex min-w-0 flex-1 items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-ink-faint">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        <SortMenu list={data.list} sort={data.sort} label={title} />
      </div>
      {data.items.length === 0 ? (
        <p className="px-2 py-1 text-caption text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-0.5 space-y-0.5">
          {data.items.map((item, index) => {
            const href = `/users/work/projects/${item.id}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={item.id} className="group flex items-center rounded-md hover:bg-surface-muted focus-within:bg-surface-muted">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-keyshortcuts={manual ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                  onKeyDown={(event) => {
                    if (!manual || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                    event.preventDefault();
                    if (!pending) move(item.id, event.key === "ArrowUp" ? "up" : "down");
                  }}
                  className={`flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-label ${active ? "font-semibold text-primary-700" : "text-ink"}`}
                  data-testid="sidebar-project"
                >
                  <ProjectDot color={item.color} />
                  <span className="truncate">{item.name}</span>
                </Link>
                {manual && data.items.length > 1 && (
                  <span className="hidden shrink-0 items-center pr-1 group-hover:flex group-focus-within:flex">
                    <button type="button" aria-label={`Move ${item.name} up`} disabled={pending || index === 0} onClick={() => move(item.id, "up")} className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:text-ink disabled:opacity-30">
                      <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label={`Move ${item.name} down`} disabled={pending || index === data.items.length - 1} onClick={() => move(item.id, "down")} className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:text-ink disabled:opacity-30">
                      <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {live}
      </span>
    </section>
  );
}

function PortfolioLinks({ items }: { items: { id: number; name: string; color: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5" aria-label="Starred portfolios" data-testid="sidebar-portfolios">
      {items.map((item) => {
        const href = `/users/work/portfolios/${item.id}`;
        const active = pathname === href;
        return (
          <li key={item.id} className="rounded-md hover:bg-surface-muted focus-within:bg-surface-muted">
            <Link href={href} aria-current={active ? "page" : undefined} className={`flex h-8 min-w-0 items-center gap-2 px-2 text-label ${active ? "font-semibold text-primary-700" : "text-ink"}`} data-testid="sidebar-portfolio">
              <Briefcase aria-hidden="true" className="h-3.5 w-3.5 shrink-0" style={{ color: identityColor(item.color) }} />
              <span className="truncate">{item.name}</span>
            </Link>
          </li>
        );
      })}
      <li>
        <Link href="/users/work/portfolios" aria-current={pathname === "/users/work/portfolios" ? "page" : undefined} className="flex h-8 items-center gap-2 px-2 text-label text-ink-muted hover:text-ink" data-testid="sidebar-portfolios-link">
          <Briefcase aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          All portfolios
        </Link>
      </li>
    </ul>
  );
}

function SortMenu({ list, sort, label }: { list: SidebarList; sort: SidebarSort; label: string }) {
  const { call, pending } = useWorkCall();
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (box.current?.open && !inside(event, box.current)) box.current.open = false;
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <details ref={box} className="relative" data-testid={`sidebar-sort-${list.toLowerCase()}`}>
      <summary aria-label={`Sort ${label}: ${SIDEBAR_SORT_LABEL[sort]}`} title={`Sort: ${SIDEBAR_SORT_LABEL[sort]}`} className="grid h-6 w-6 cursor-pointer list-none place-items-center rounded text-ink-faint hover:bg-surface-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />
      </summary>
      <div role="group" aria-label={`Sort ${label}`} className="absolute right-0 z-popover mt-1 w-44 rounded-lg border border-line bg-raised p-1 text-label shadow-overlay">
        {SIDEBAR_SORTS.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={choice === sort}
            disabled={pending}
            onClick={() => {
              if (box.current) box.current.open = false;
              if (choice !== sort) void call(() => sidebarSortAction(list, choice), { success: false });
            }}
            className={`flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-surface-muted ${choice === sort ? "font-semibold text-primary-700" : ""}`}
          >
            {SIDEBAR_SORT_LABEL[choice]}
          </button>
        ))}
      </div>
    </details>
  );
}
