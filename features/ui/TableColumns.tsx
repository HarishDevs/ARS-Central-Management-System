"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// v1.59.2 (D-361, owner: "all the columns in all the tables should be
// resizable to adjust the visible data in the tables"): mounted once in the
// app shell. Near the right edge of any column title the pointer becomes a
// resize cursor; drag to resize the column, double-click to go back to the
// automatic width. Widths are kept per page and table in this browser.
// Nothing is added inside the page's own markup (a table may still be
// hydrating while this runs; an extra element there breaks hydration): only
// the header cell's width style and a data-col-edge mark while hovered.
// A table opts out with data-no-resize.

const MIN = 48;
const MAX = 900;
const EDGE = 6; // px either side of a column's right edge

export const clampWidth = (width: number) => Math.round(Math.min(MAX, Math.max(MIN, width)));

const storageKey = (path: string, index: number) => `ars.colw:${path}:${index}`;

function readWidths(key: string): (number | null)[] {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(value) ? value.map((width) => (typeof width === "number" && width >= MIN && width <= MAX ? width : null)) : [];
  } catch {
    return [];
  }
}

function writeWidths(key: string, widths: (number | null)[]) {
  try {
    if (widths.every((width) => width === null)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // Storage may be blocked (private window): the widths then last for this visit only.
  }
}

function setWidth(cell: HTMLTableCellElement, width: number | null) {
  if (width === null) {
    cell.style.removeProperty("width");
    cell.style.removeProperty("min-width");
  } else {
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
  }
}

const eligible = (main: HTMLElement) => Array.from(main.querySelectorAll<HTMLTableElement>("table")).filter((table) => table.tHead && !table.closest("[data-no-resize]"));

function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const rows = table.tHead?.rows;
  const row = rows ? rows[rows.length - 1] : undefined;
  return row ? (Array.from(row.cells) as HTMLTableCellElement[]) : [];
}

// The header cell whose right edge is under the pointer (or the one before, at a left edge).
function edgeCell(target: EventTarget | null, x: number): HTMLTableCellElement | null {
  const cell = target instanceof Element ? target.closest<HTMLTableCellElement>("thead th, thead td") : null;
  const table = cell?.closest("table");
  if (!cell || !table || !table.tHead || table.closest("[data-no-resize]")) return null;
  const rect = cell.getBoundingClientRect();
  if (x >= rect.right - EDGE && x <= rect.right + EDGE) return cell;
  if (x <= rect.left + EDGE) {
    const before = cell.previousElementSibling;
    return before instanceof HTMLTableCellElement ? before : null;
  }
  return null;
}

export function TableColumns() {
  const pathname = usePathname();
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const keyOf = (table: HTMLTableElement) => storageKey(pathname, eligible(main).indexOf(table));
    const save = (table: HTMLTableElement) => writeWidths(keyOf(table), headerCells(table).map((cell) => (cell.style.width ? Number.parseFloat(cell.style.width) : null)));

    // Saved widths, also for tables that appear later (client navigation, drawers, streamed parts).
    const applied = new WeakSet<HTMLTableElement>();
    let queued = false;
    const restore = () => {
      queued = false;
      eligible(main).forEach((table, index) => {
        if (applied.has(table)) return;
        applied.add(table);
        const widths = readWidths(storageKey(pathname, index));
        headerCells(table).forEach((cell, at) => {
          const width = widths[at];
          if (typeof width === "number") setWidth(cell, width);
        });
      });
    };
    restore();
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(restore);
    });
    observer.observe(main, { childList: true, subtree: true });

    let hovered: HTMLTableCellElement | null = null;
    let dragging = false;
    let swallowClick = false;
    const mark = (cell: HTMLTableCellElement | null) => {
      if (hovered === cell) return;
      hovered?.removeAttribute("data-col-edge");
      hovered = cell;
      cell?.setAttribute("data-col-edge", "");
      document.body.classList.toggle("col-edge", Boolean(cell));
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) mark(edgeCell(event.target, event.clientX));
    };
    const onLeave = () => {
      if (!dragging) mark(null);
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const cell = edgeCell(event.target, event.clientX);
      const table = cell?.closest("table");
      if (!cell || !table) return;
      // At an edge: resize, and don't sort, follow a link or start dragging the column.
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      swallowClick = true;
      document.body.classList.add("col-resizing");
      const startX = event.clientX;
      const startWidth = cell.getBoundingClientRect().width;
      const move = (next: PointerEvent) => setWidth(cell, clampWidth(startWidth + next.clientX - startX));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        document.body.classList.remove("col-resizing");
        dragging = false;
        save(table as HTMLTableElement);
        // The click that follows the drag must not sort the column.
        window.setTimeout(() => (swallowClick = false), 0);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick && !edgeCell(event.target, event.clientX)) return;
      event.preventDefault();
      event.stopPropagation();
      swallowClick = false;
    };
    const onDouble = (event: MouseEvent) => {
      const cell = edgeCell(event.target, event.clientX);
      const table = cell?.closest("table");
      if (!cell || !table) return;
      event.preventDefault();
      event.stopPropagation();
      setWidth(cell, null);
      save(table as HTMLTableElement);
    };
    const onDragStart = (event: DragEvent) => {
      if (dragging || edgeCell(event.target, event.clientX)) event.preventDefault();
    };
    // Text cut to two lines in a cell: hovering shows all of it.
    const reveal = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".data-table td .cell-text, .data-table td > a, .data-table td > p, .data-table td .clamp-2") : null;
      if (!target || target.hasAttribute("title")) return;
      if (target.scrollHeight > target.clientHeight + 1) target.title = target.textContent?.trim() ?? "";
    };
    main.addEventListener("pointermove", onMove);
    main.addEventListener("pointerleave", onLeave);
    main.addEventListener("pointerdown", onDown, true);
    main.addEventListener("click", onClick, true);
    main.addEventListener("dblclick", onDouble, true);
    main.addEventListener("dragstart", onDragStart, true);
    main.addEventListener("mouseover", reveal);
    return () => {
      observer.disconnect();
      mark(null);
      main.removeEventListener("pointermove", onMove);
      main.removeEventListener("pointerleave", onLeave);
      main.removeEventListener("pointerdown", onDown, true);
      main.removeEventListener("click", onClick, true);
      main.removeEventListener("dblclick", onDouble, true);
      main.removeEventListener("dragstart", onDragStart, true);
      main.removeEventListener("mouseover", reveal);
    };
  }, [pathname]);
  return null;
}
