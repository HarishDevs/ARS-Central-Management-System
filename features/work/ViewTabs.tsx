"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Copy, FileText, GanttChart, Info, LayoutDashboard, LayoutList, Link2, MessagesSquare, MoreHorizontal, Paperclip, Pencil, Plus, SquareKanban, Star, StickyNote, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { myTasksTabAction, projectTabAction } from "@/app/users/work/actions";
import { Menu, type MenuItem } from "@/features/ui/Menu";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { useWorkCall } from "@/features/work/client";
import { addableViews, catalogueGroups, maxTabs, moveKey, placeKey, tabHref, tabMenuEntries, TAB_NAME_MAX, type StripTab, type TabScope } from "@/server/work/view-tabs";

const VIEW_ICON: Record<string, React.ReactNode> = {
  LIST: <LayoutList className="h-4 w-4" />,
  PAGE: <FileText className="h-4 w-4" />,
  GANTT: <GanttChart className="h-4 w-4" />,
  BOARD: <SquareKanban className="h-4 w-4" />,
  CALENDAR: <CalendarDays className="h-4 w-4" />,
  TIMELINE: <GanttChart className="h-4 w-4 -scale-x-100" />,
  WORKLOAD: <Users className="h-4 w-4" />,
  DASHBOARD: <LayoutDashboard className="h-4 w-4" />,
  FILES: <Paperclip className="h-4 w-4" />,
  MESSAGES: <MessagesSquare className="h-4 w-4" />,
  OVERVIEW: <Info className="h-4 w-4" />,
  NOTES: <StickyNote className="h-4 w-4" />, // v1.78.0 (D-405)
};

// v1.61.0 (D-367, spec PRJ-15): the project's tab strip. Every tab is a view
// (List, Board, Calendar, Timeline, Overview) with its own saved state. Owners
// and editors: "+" adds a tab from the catalogue; each tab's menu renames it,
// sets it as the default, duplicates it, copies its link or removes it.
// Reorder by dragging, or with the keyboard: Alt + ← / → on a focused tab
// (announced), or "Move left / right" in its menu. Everyone else can copy links.
// v1.63.0 (D-369, PM-A13): the same strip for a person's My Tasks (scope
// MY_TASKS): their own tabs, List / Board / Calendar only.
export function ViewTabs({ projectId = 0, scope = "PROJECT", base, strip, activeKey, canEdit, label = "Project views", planning = false, reporting = false, extras = false }: { projectId?: number; scope?: TabScope; base: string; strip: StripTab[]; activeKey: string | null; canEdit: boolean; label?: string; planning?: boolean; reporting?: boolean; extras?: boolean }) {
  const { call, pending } = useWorkCall();
  const toast = useToast();
  const router = useRouter();
  const [order, setOrder] = useState(strip.map((tab) => tab.key));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const stripKey = strip.map((tab) => `${tab.key}:${tab.name}:${tab.isDefault}`).join("|");
  useEffect(() => setOrder(strip.map((tab) => tab.key)), [stripKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byKey = new Map(strip.map((tab) => [tab.key, tab]));
  const tabs = order.map((key) => byKey.get(key)).filter((tab): tab is StripTab => Boolean(tab));
  const focusTab = (key: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tab-key="${key}"] a`)?.focus());

  const run = async (input: Parameters<typeof projectTabAction>[1], success?: string | false) => {
    const result = await call(() => (scope === "MY_TASKS" ? myTasksTabAction(input) : projectTabAction(projectId, input)), success === undefined ? {} : { success });
    return result?.ok ? result : null;
  };
  const reorder = async (next: string[], moved: string) => {
    const before = order;
    setOrder(next);
    const index = next.indexOf(moved);
    setLive(`${byKey.get(moved)?.name ?? "Tab"} moved to position ${index + 1} of ${next.length}.`);
    focusTab(moved);
    if (!(await run({ op: "reorder", keys: next }, false))) setOrder(before);
  };
  const copyLink = (tab: StripTab) => {
    const url = `${window.location.origin}${tabHref(base, tab)}`;
    void copyText(url).then((done) => toast(done ? { tone: "success", title: "Link copied." } : { tone: "error", title: `${COPY_BLOCKED} ${url}` }));
  };

  return (
    <div className="mb-3 border-b border-line">
      <nav aria-label={label} className="flex flex-wrap items-end gap-0.5" data-testid="view-tabs">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <span
              key={tab.key}
              data-tab-key={tab.key}
              className={`group -mb-px inline-flex items-center border-b-2 ${active ? "border-primary-600" : "border-transparent"} ${dragging === tab.key ? "opacity-50" : ""}`}
              draggable={canEdit && renaming === null}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDragging(tab.key);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => dragging && event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging && dragging !== tab.key) void reorder(placeKey(order, dragging, tab.key), dragging);
                setDragging(null);
              }}
              data-testid="view-tab"
            >
              {renaming === tab.key ? (
                <RenameBox
                  name={tab.name}
                  onDone={async (name) => {
                    setRenaming(null);
                    if (name !== null && name !== tab.name) await run({ op: "rename", key: tab.key, name });
                    focusTab(tab.key);
                  }}
                />
              ) : (
                <Link
                  href={tabHref(base, tab)}
                  aria-current={active ? "page" : undefined}
                  aria-keyshortcuts={canEdit ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
                  onKeyDown={(event) => {
                    if (!canEdit || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                    event.preventDefault();
                    const next = moveKey(order, tab.key, event.key === "ArrowLeft" ? -1 : 1);
                    if (next.join() !== order.join()) void reorder(next, tab.key);
                  }}
                  className={`flex items-center gap-1 px-3 py-2 text-label ${active ? "font-semibold text-primary-700" : "text-ink-muted hover:text-ink"}`}
                >
                  {tab.name}
                  {tab.isDefault && <Star aria-label="(default)" className="h-3 w-3 fill-current text-ink-faint" />}
                </Link>
              )}
              {renaming !== tab.key && (
                // v1.72.0 (D-387, spec PM §3.7.3): the tab's menu is an ARIA menu in the spec's order.
                <Menu
                  label={`Tab menu: ${tab.name}`}
                  trigger={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />}
                  buttonClass={`mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-surface-muted hover:text-ink aria-expanded:opacity-100 ${active ? "" : "sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 [@media(hover:none)]:!opacity-100"}`}
                  align="left"
                  menuClass="w-56"
                  testId="tab-menu"
                  items={tabMenuEntries(tab, tabs, canEdit, maxTabs(scope)).map((entry): MenuItem => {
                    switch (entry.key) {
                      case "separator":
                        return { kind: "separator", label: "" };
                      case "rename":
                        return { label: "Rename", icon: <Pencil className="h-4 w-4" />, onSelect: () => setRenaming(tab.key) };
                      case "default":
                        return { label: "Set as default", icon: <Star className="h-4 w-4" />, disabled: entry.disabled, hint: entry.disabled ? "This tab opens first" : undefined, onSelect: () => void run({ op: "default", key: tab.key }) };
                      case "duplicate":
                        return { label: "Make a copy", icon: <Copy className="h-4 w-4" />, onSelect: () => void run({ op: "duplicate", key: tab.key }).then((result) => result?.value?.id && router.push(`${base}?tab=${result.value.id}`)) };
                      case "copy":
                        return { label: "Copy link", icon: <Link2 className="h-4 w-4" />, onSelect: () => copyLink(tab) };
                      case "left":
                        return { label: "Move left", icon: <ChevronLeft className="h-4 w-4" />, shortcut: "Alt+←", onSelect: () => void reorder(moveKey(order, tab.key, -1), tab.key) };
                      case "right":
                        return { label: "Move right", icon: <ChevronRight className="h-4 w-4" />, shortcut: "Alt+→", onSelect: () => void reorder(moveKey(order, tab.key, 1), tab.key) };
                      case "remove":
                        return {
                          label: "Remove",
                          tone: "danger",
                          icon: <Trash2 className="h-4 w-4" />,
                          onSelect: () => {
                            if (!window.confirm(`Remove the tab "${tab.name}"? Its saved filters and sort go with it; tasks are not touched.`)) return;
                            void run({ op: "remove", key: tab.key }).then((result) => result && active && router.push(base));
                          },
                        };
                    }
                  })}
                />
              )}
            </span>
          );
        })}
        {canEdit && (
          // v1.72.0 (D-387, spec PM §3.7.2): the Add tab menu, Popular then Other, an icon and a line for each view.
          <Menu
            label="Add tab"
            trigger={
              <span className="inline-flex items-center gap-1">
                <Plus aria-hidden="true" className="h-4 w-4" /> <span className="sr-only sm:not-sr-only">Add tab</span>
              </span>
            }
            buttonClass="mb-1 ml-1 inline-flex items-center rounded px-2 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink"
            align="left"
            menuClass="w-80"
            testId="add-tab"
            items={catalogueGroups(addableViews(scope, planning, reporting, extras)).flatMap((group): MenuItem[] => [
              { kind: "heading", label: group.name },
              ...group.entries.map(
                (entry): MenuItem => ({
                  label: entry.label,
                  hint: entry.description,
                  icon: VIEW_ICON[entry.type] ?? <LayoutList className="h-4 w-4" />,
                  disabled: pending,
                  testId: `add-tab-${entry.type.toLowerCase()}`,
                  onSelect: () => void run({ op: "add", type: entry.type }).then((result) => result?.value?.id && router.push(`${base}?tab=${result.value.id}`)),
                }),
              ),
            ])}
          />
        )}
      </nav>
      <span role="status" aria-live="polite" className="sr-only" data-testid="tabs-live">
        {live}
      </span>
    </div>
  );
}

function RenameBox({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const box = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, []);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  return (
    <input
      ref={box}
      aria-label={`New name for ${name}`}
      value={value}
      maxLength={TAB_NAME_MAX}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(value.trim() || null);
        if (event.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value.trim() || null)}
      className="field-input field-compact my-1 w-40 text-label"
      data-testid="tab-rename"
    />
  );
}
