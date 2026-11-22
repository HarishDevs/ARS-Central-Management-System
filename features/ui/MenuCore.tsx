"use client";

import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { inside } from "@/features/ui/inside";
import { menuMove, menuTypeahead } from "@/features/ui/menu-keys";

// A dropdown menu (UI-03), v1.72.0 (D-387, owner: "use dropdowns wherever
// required"): one accessible menu for every "▾" and "⋯" of the project
// screens. A button with aria-haspopup="menu" opens a role="menu" list placed
// against the window (position: fixed), so scrolling tables and the task pane
// never clip it. Keys: ↓/↑ (wrapping), Home/End, a letter jumps to the next
// item starting with it, Enter/Space choose, → opens a submenu, ← or Escape
// closes it, Escape closes the menu and returns focus to the button, Tab
// closes it and moves on. Entries: plain items (links or actions), radio and
// checkbox items (aria-checked, the menu stays open), headings, separators,
// disabled items and one level of submenus.
// v1.73.0 (D-396): used on every PM screen (part 2); a picker's radio item can
// close the menu (`close`), and a menu inside a transformed window is placed
// from that window (`fixedOrigin`).
export interface MenuItem {
  label: string;
  href?: string;
  onSelect?: () => void;
  icon?: React.ReactNode;
  tone?: "default" | "danger";
  kind?: "item" | "radio" | "checkbox" | "heading" | "separator" | "submenu";
  checked?: boolean;
  disabled?: boolean;
  hint?: string;
  shortcut?: string;
  download?: boolean;
  testId?: string;
  badge?: string; // v1.72.2: a count on the right (e.g. unread)
  close?: boolean; // v1.73.0 (D-396): a radio or checkbox item that closes the menu once chosen (a picker)
  items?: MenuItem[]; // kind "submenu"
}

type Place = React.CSSProperties;

// v1.73.0 (D-396): a transformed (or filtered) ancestor, such as the centred
// Create task window, becomes the containing block of a position: fixed menu,
// so the menu's place is measured from that ancestor instead of the window.
function fixedOrigin(element: HTMLElement): { left: number; top: number; bottom: number } {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.transform !== "none" || style.filter !== "none" || style.perspective !== "none" || /paint|layout|strict|content/.test(style.contain) || /transform|filter/.test(style.willChange)) {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, bottom: rect.bottom };
    }
  }
  return { left: 0, top: 0, bottom: window.innerHeight };
}

function usePlace(open: boolean, anchor: React.RefObject<HTMLElement | null>, panel: React.RefObject<HTMLElement | null>, align: "left" | "right", side: "below" | "right"): Place {
  const [place, setPlace] = useState<Place>({ position: "fixed", opacity: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = anchor.current?.getBoundingClientRect();
      const element = panel.current;
      if (!box || !element) return;
      const width = element.offsetWidth;
      const height = element.scrollHeight;
      if (side === "right") {
        const fitsRight = box.right + width + 4 <= window.innerWidth - 8;
        const left = fitsRight ? box.right + 2 : Math.max(8, box.left - width - 2);
        const top = Math.max(8, Math.min(box.top - 4, window.innerHeight - Math.min(height, window.innerHeight - 16) - 8));
        const origin = fixedOrigin(element);
        setPlace({ position: "fixed", left: left - origin.left, top: top - origin.top, maxHeight: window.innerHeight - 16, zIndex: "calc(var(--z-popover) + 1)" });
        return;
      }
      const below = window.innerHeight - box.bottom - 8;
      const above = box.top - 8;
      const up = below < Math.min(height, 260) && above > below;
      const wanted = align === "right" ? box.right - width : box.left;
      const left = Math.min(Math.max(8, wanted), Math.max(8, window.innerWidth - width - 8));
      const origin = fixedOrigin(element);
      setPlace({ position: "fixed", left: left - origin.left, maxHeight: Math.max(140, (up ? above : below) - 4), zIndex: "var(--z-popover)", ...(up ? { bottom: origin.bottom - box.top + 4 } : { top: box.bottom + 4 - origin.top }) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchor, panel, align, side]);
  return place;
}

const focusables = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLElement>(":scope > [role^='menuitem']:not([aria-disabled='true']), :scope > [data-menu-row] > [role^='menuitem']:not([aria-disabled='true'])") ?? [])];

export function Menu({
  label,
  trigger,
  items,
  align = "right",
  buttonClass = "btn-ghost btn-compact",
  menuClass = "min-w-48",
  testId,
  title,
  onOpenChange,
  menuLabel,
  header,
  className = "relative inline-flex",
  side = "below",
}: {
  label: string;
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  buttonClass?: string;
  menuClass?: string;
  testId?: string;
  title?: string;
  onOpenChange?: (open: boolean) => void;
  menuLabel?: string; // the list's name when it differs from the button's
  header?: React.ReactNode; // v1.72.2 (D-394): plain words above the items (who you are), not focusable
  className?: string; // v1.73.0 (D-396): the wrapper's classes (e.g. "relative flex" for a full-width button)
  side?: "below" | "right"; // v1.80.0 (D-407): "right" opens beside the button (the folded sidebar's +)
}) {
  const [open, setOpenState] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const place = usePlace(open, button, header ? panel : list, align, side);
  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );
  const firstFocus = useRef<"first" | "last">("first");

  useEffect(() => {
    if (!open) return;
    const entries = focusables(list.current);
    (firstFocus.current === "last" ? entries.at(-1) : entries[0])?.focus();
    const onDown = (event: MouseEvent) => {
      if (box.current && !inside(event, box.current)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, setOpen]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  return (
    <div ref={box} className={className} data-testid={testId} data-open={open || undefined}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={title}
        onClick={() => {
          firstFocus.current = "first";
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            firstFocus.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
        }}
        className={buttonClass}
      >
        {trigger}
      </button>
      {open &&
        (header ? (
          // A header (plain words) and the list share one panel; the list scrolls.
          <div ref={panel} style={place} className={`flex flex-col ${MENU_PANEL} ${menuClass}`}>
            <div className="shrink-0">{header}</div>
            <MenuList id={menuId} ref={list} label={menuLabel ?? label} items={items} style={{}} className="min-h-0 flex-1" onClose={close} bare />
          </div>
        ) : (
          <MenuList id={menuId} ref={list} label={menuLabel ?? label} items={items} style={place} className={menuClass} onClose={close} />
        ))}
    </div>
  );
}

// One look for every menu and popover panel (QA visual G6): raised surface,
// overlay shadow, the popover layer.
export const MENU_PANEL = "menu-pop rounded-lg border border-line bg-raised p-1 text-ink shadow-overlay";

function MenuList({ id, label, items, style, className, onClose, onBack, ref, bare = false }: { id?: string; label: string; items: MenuItem[]; style: Place; className: string; onClose: (refocus: boolean) => void; ref: React.RefObject<HTMLDivElement | null>; onBack?: () => void; bare?: boolean }) {
  const [sub, setSub] = useState<number | null>(null);
  const subFocus = useRef(false);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest("[role='menu']") !== ref.current) return; // a submenu handles its own keys
    const entries = focusables(ref.current);
    const index = entries.indexOf(document.activeElement as HTMLElement);
    if (onBack && (event.key === "Escape" || event.key === "ArrowLeft")) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === "Tab") {
      onClose(false);
      return;
    }
    const current = entries[index];
    if (event.key === "ArrowRight" && current?.getAttribute("aria-haspopup") === "menu") {
      event.preventDefault();
      subFocus.current = true;
      setSub(Number(current.dataset.index));
      return;
    }
    const next = menuMove(entries.length, index, event.key);
    if (next !== null) {
      event.preventDefault();
      entries[next]?.focus();
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const hit = menuTypeahead(
        entries.map((entry) => entry.textContent ?? ""),
        index,
        event.key,
      );
      if (hit !== null) {
        event.preventDefault();
        entries[hit]?.focus();
      }
    }
  };
  const itemClass = (item: MenuItem) =>
    `flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-label focus:outline-none ${item.disabled ? "cursor-not-allowed text-ink-faint" : `hover:bg-surface-muted focus:bg-surface-muted ${item.tone === "danger" ? "text-danger-600" : "text-ink"}`}`;
  return (
    // tabIndex 0: a long menu scrolls, and a scrolling region must be reachable by keyboard (axe scrollable-region-focusable).
    <div id={id} ref={ref} role="menu" aria-label={label} tabIndex={0} style={style} onKeyDown={onKeyDown} className={`overflow-y-auto focus:outline-none ${bare ? "" : MENU_PANEL} ${className}`}>
      {items.map((item, index) => {
        const key = `${index}-${item.label}`;
        if (item.kind === "separator") return <div key={key} role="separator" className="my-1 border-t border-line" />;
        if (item.kind === "heading")
          return (
            <div key={key} role="presentation" className="px-3 pb-0.5 pt-2 text-caption font-semibold text-ink-muted">
              {item.label}
            </div>
          );
        const body = (
          <>
            {(item.kind === "radio" || item.kind === "checkbox") && (
              <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                {item.checked && <Check className="h-4 w-4" />}
              </span>
            )}
            {item.icon && (
              <span aria-hidden="true" className="inline-flex shrink-0 text-ink-muted">
                {item.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.hint && <span className="block text-caption text-ink-muted">{item.hint}</span>}
            </span>
            {item.shortcut && <span className="ml-3 shrink-0 text-caption text-ink-faint">{item.shortcut}</span>}
            {item.badge && <span className="ml-3 shrink-0 rounded-full bg-danger-solid px-1.5 text-[length:calc(11px*var(--text-scale,1))] font-semibold leading-[18px] text-on-solid">{item.badge}</span>}
            {item.kind === "submenu" && <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />}
          </>
        );
        const role = item.kind === "radio" ? "menuitemradio" : item.kind === "checkbox" ? "menuitemcheckbox" : "menuitem";
        const common = {
          role,
          tabIndex: -1,
          "data-index": index,
          "data-testid": item.testId,
          "aria-disabled": item.disabled || undefined,
          "aria-checked": item.kind === "radio" || item.kind === "checkbox" ? Boolean(item.checked) : undefined,
          className: itemClass(item),
        } as const;
        if (item.kind === "submenu")
          return (
            <SubmenuRow
              key={key}
              item={item}
              index={index}
              open={sub === index}
              focusFirst={subFocus}
              onOpen={(how) => {
                subFocus.current = how === "keys";
                setSub(index);
              }}
              onShut={() => setSub(null)}
              onClose={onClose}
              className={itemClass(item)}
            >
              {body}
            </SubmenuRow>
          );
        if (item.href && !item.disabled)
          return (
            <Link key={key} {...common} href={item.href} download={item.download || undefined} prefetch={false} onMouseEnter={() => setSub(null)} onClick={() => onClose(false)}>
              {body}
            </Link>
          );
        return (
          <button
            key={key}
            type="button"
            {...common}
            onMouseEnter={() => setSub(null)}
            onClick={() => {
              if (item.disabled) return;
              if ((item.kind === "radio" || item.kind === "checkbox") && !item.close) {
                item.onSelect?.();
                return;
              }
              onClose(!item.href);
              item.onSelect?.();
            }}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

function SubmenuRow({ item, index, open, focusFirst, onOpen, onShut, onClose, className, children }: { item: MenuItem; index: number; open: boolean; focusFirst: React.RefObject<boolean>; onOpen: (how: "keys" | "pointer") => void; onShut: () => void; onClose: (refocus: boolean) => void; className: string; children: React.ReactNode }) {
  const row = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const place = usePlace(open, row, list, "left", "right");
  useEffect(() => {
    if (open && focusFirst.current) focusables(list.current)[0]?.focus();
  }, [open, focusFirst]);
  return (
    <div data-menu-row className="contents">
      <button
        ref={row}
        type="button"
        role="menuitem"
        tabIndex={-1}
        data-index={index}
        data-testid={item.testId}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
        onMouseEnter={() => onOpen("pointer")}
        onClick={() => onOpen("keys")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen("keys");
          }
        }}
      >
        {children}
      </button>
      {open && (
        <MenuList
          ref={list}
          label={item.label}
          items={item.items ?? []}
          style={place}
          className="min-w-52"
          onClose={onClose}
          onBack={() => {
            onShut();
            row.current?.focus();
          }}
        />
      )}
    </div>
  );
}
