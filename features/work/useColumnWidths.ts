"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Owner: "all the columns in all the tables should be resizable to adjust the
// visible data in the tables". The task lists are CSS grids, so one widths
// state builds the grid template the header and every row share. A width is
// kept per grid in this browser only (localStorage, `ars.gridw:<key>`).
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 800;
export const RESIZE_STEP = 16;
export const STORAGE_PREFIX = "ars.gridw:";

export interface ColumnDefault {
  key: string;
  // The default width in pixels (for a flexible column: its minimum).
  width: number;
  // A flexible column fills the spare room (minmax(width,1fr)) until resized.
  flex?: boolean;
}

export type ColumnWidths = Record<string, number>;

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

// The grid-template-columns value for the resizable columns, in order.
export function buildTemplate(defaults: ColumnDefault[], widths: ColumnWidths): string {
  return defaults
    .map((column) => {
      const set = widths[column.key];
      if (typeof set === "number") return `${clampWidth(set)}px`;
      return column.flex ? `minmax(${column.width}px,1fr)` : `${column.width}px`;
    })
    .join(" ");
}

// What was saved, read safely: only finite numbers, clamped; anything else is dropped.
export function parseStoredWidths(raw: string | null): ColumnWidths {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: ColumnWidths = {};
    for (const [key, width] of Object.entries(value as Record<string, unknown>)) {
      if (typeof width === "number" && Number.isFinite(width)) out[key] = clampWidth(width);
    }
    return out;
  } catch {
    return {};
  }
}

export function useColumnWidths(storageKey: string, defaults: ColumnDefault[]) {
  const key = `${STORAGE_PREFIX}${storageKey}`;
  // Empty on the server and the first client render (no hydration mismatch);
  // the saved widths are read after mount.
  const [widths, setWidths] = useState<ColumnWidths>({});
  const latest = useRef<ColumnWidths>({});
  useEffect(() => {
    let saved: ColumnWidths = {};
    try {
      saved = parseStoredWidths(window.localStorage.getItem(key));
    } catch {
      saved = {};
    }
    latest.current = saved;
    setWidths(saved);
  }, [key]);

  const commit = useCallback(
    (next: ColumnWidths) => {
      latest.current = next;
      setWidths(next);
      try {
        if (Object.keys(next).length) window.localStorage.setItem(key, JSON.stringify(next));
        else window.localStorage.removeItem(key);
      } catch {
        // Storage may be blocked or full: the widths still apply on this page.
      }
    },
    [key],
  );
  const setWidth = useCallback(
    (column: string, width: number) => {
      const next = clampWidth(width);
      if (latest.current[column] === next) return;
      commit({ ...latest.current, [column]: next });
    },
    [commit],
  );
  const reset = useCallback(
    (column?: string) => {
      if (column === undefined) return commit({});
      if (!(column in latest.current)) return;
      const next = { ...latest.current };
      delete next[column];
      commit(next);
    },
    [commit],
  );
  return { widths, setWidth, reset, template: buildTemplate(defaults, widths) };
}
