"use client";

import { ChevronLeft, ChevronRight, Copy, Link2, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { projectTabAction } from "@/app/users/work/actions";
import { Drop } from "@/features/ui/Drop";
import { useToast } from "@/features/ui/Toast";
import { COPY_BLOCKED, copyText } from "@/features/ui/clipboard";
import { useWorkCall } from "@/features/work/client";
import { addableViews, moveKey, placeKey, tabHref, tabMenu, TAB_NAME_MAX, type StripTab } from "@/server/work/view-tabs";

// v1.61.0 (D-367, spec PRJ-15): the project's tab strip. Every tab is a view
// (List, Board, Calendar, Timeline, Overview) with its own saved state. Owners
// and editors: "+" adds a tab from the catalogue; each tab's menu renames it,
// sets it as the default, duplicates it, copies its link or removes it.
// Reorder by dragging, or with the keyboard: Alt + ← / → on a focused tab
// (announced), or "Move left / right" in its menu. Everyone else can copy links.
export function ViewTabs({ projectId, base, strip, activeKey, canEdit }: { projectId: number; base: string; strip: StripTab[]; activeKey: string | null; canEdit: boolean }) {
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
    const result = await call(() => projectTabAction(projectId, input), success === undefined ? {} : { success });
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
  const closeMenu = (event: React.SyntheticEvent) => {
    const details = (event.currentTarget as HTMLElement).closest("details");
    if (details) details.open = false;
  };

  return (
    <div className="mb-3 border-b border-line">
      <nav aria-label="Project views" className="flex flex-wrap items-end gap-0.5" data-testid="view-tabs">
        {tabs.map((tab, index) => {
          const active = tab.key === activeKey;
          const menu = tabMenu(tab, tabs, canEdit);
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
                <Drop
                  label={`Tab menu: ${tab.name}`}
                  icon={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />}
                  buttonClass={`mr-1 inline-flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:bg-surface-muted hover:text-ink ${active ? "" : "sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"}`}
                  panelClass="left-0 w-56"
                  testId="tab-menu"
                >
                  <div role="menu" aria-label={`${tab.name} tab`} className="space-y-0.5 pt-5">
                    {menu.includes("rename") && (
                      <MenuItem
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={(event) => {
                          closeMenu(event);
                          setRenaming(tab.key);
                        }}
                      >
                        Rename
                      </MenuItem>
                    )}
                    {menu.includes("default") && (
                      <MenuItem
                        icon={<Star className="h-4 w-4" />}
                        onClick={(event) => {
                          closeMenu(event);
                          void run({ op: "default", key: tab.key });
                        }}
                      >
                        Set as default
                      </MenuItem>
                    )}
                    {menu.includes("duplicate") && (
                      <MenuItem
                        icon={<Copy className="h-4 w-4" />}
                        onClick={(event) => {
                          closeMenu(event);
                          void run({ op: "duplicate", key: tab.key }).then((result) => result?.value?.id && router.push(`${base}?tab=${result.value.id}`));
                        }}
                      >
                        Duplicate
                      </MenuItem>
                    )}
                    <MenuItem
                      icon={<Link2 className="h-4 w-4" />}
                      onClick={(event) => {
                        closeMenu(event);
                        copyLink(tab);
                      }}
                    >
                      Copy link
                    </MenuItem>
                    {canEdit && index > 0 && (
                      <MenuItem
                        icon={<ChevronLeft className="h-4 w-4" />}
                        onClick={(event) => {
                          closeMenu(event);
                          void reorder(moveKey(order, tab.key, -1), tab.key);
                        }}
                      >
                        Move left
                      </MenuItem>
                    )}
                    {canEdit && index < tabs.length - 1 && (
                      <MenuItem
                        icon={<ChevronRight className="h-4 w-4" />}
                        onClick={(event) => {
                          closeMenu(event);
                          void reorder(moveKey(order, tab.key, 1), tab.key);
                        }}
                      >
                        Move right
                      </MenuItem>
                    )}
                    {menu.includes("remove") && (
                      <MenuItem
                        danger
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={(event) => {
                          closeMenu(event);
                          if (!window.confirm(`Remove the tab "${tab.name}"? Its saved filters and sort go with it; tasks are not touched.`)) return;
                          void run({ op: "remove", key: tab.key }).then((result) => result && active && router.push(base));
                        }}
                      >
                        Remove
                      </MenuItem>
                    )}
                  </div>
                </Drop>
              )}
            </span>
          );
        })}
        {canEdit && (
          <Drop
            label="Add tab"
            icon={
              <span className="inline-flex items-center gap-1">
                <Plus aria-hidden="true" className="h-4 w-4" /> <span className="sr-only sm:not-sr-only">Add tab</span>
              </span>
            }
            buttonClass="mb-1 ml-1 inline-flex items-center rounded px-2 py-1 text-label text-ink-muted hover:bg-surface-muted hover:text-ink"
            panelClass="left-0 w-72"
            testId="add-tab"
          >
            <p className="mb-2 font-semibold">Add a tab</p>
            <ul className="space-y-0.5" aria-label="Views">
              {addableViews().map((entry) => (
                <li key={entry.type}>
                  <button
                    type="button"
                    disabled={pending}
                    className="block w-full rounded px-2 py-1.5 text-left hover:bg-surface-muted disabled:opacity-60"
                    onClick={(event) => {
                      closeMenu(event);
                      void run({ op: "add", type: entry.type }).then((result) => result?.value?.id && router.push(`${base}?tab=${result.value.id}`));
                    }}
                    data-testid={`add-tab-${entry.type.toLowerCase()}`}
                  >
                    <span className="block text-label font-medium">{entry.label}</span>
                    <span className="block text-caption text-ink-muted">{entry.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Drop>
        )}
      </nav>
      <span role="status" aria-live="polite" className="sr-only" data-testid="tabs-live">
        {live}
      </span>
    </div>
  );
}

function MenuItem({ icon, danger, onClick, children }: { icon: React.ReactNode; danger?: boolean; onClick: (event: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-label ${danger ? "text-danger-600 hover:bg-danger-50" : "hover:bg-surface-muted"}`}>
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
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
      className="field-input my-1 h-8 w-40 text-label"
      data-testid="tab-rename"
    />
  );
}
