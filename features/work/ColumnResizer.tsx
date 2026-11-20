"use client";

import { useRef } from "react";
import { clampWidth, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, RESIZE_STEP } from "@/features/work/useColumnWidths";

// The thin handle on the right edge of a column title (its parent must be
// `relative`). Drag it, or focus it and press ←/→ (16px); double-click or Enter
// puts the default width back. It never starts a sort or a drag of the row.
export function ColumnResizer({ column, label, width, onResize, onReset }: { column: string; label: string; width?: number; onResize: (width: number) => void; onReset: () => void }) {
  const drag = useRef<{ x: number; width: number; id: number } | null>(null);
  // The column's width as drawn (a flexible column has no number until resized).
  const measured = (element: HTMLElement) => Math.round(element.parentElement?.getBoundingClientRect().width ?? width ?? MIN_COLUMN_WIDTH);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={width !== undefined ? clampWidth(width) : undefined}
      title="Drag to resize (double-click to reset)"
      tabIndex={0}
      draggable={false}
      data-testid="col-resize"
      data-column={column}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: measured(event.currentTarget), id: event.pointerId };
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.id !== event.pointerId) return;
        event.preventDefault();
        onResize(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onClick={(event) => {
        event.preventDefault();
        stop(event);
      }}
      onMouseDown={stop}
      onDragStart={(event) => {
        event.preventDefault();
        stop(event);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        stop(event);
        onReset();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          stop(event);
          onResize(measured(event.currentTarget) + (event.key === "ArrowRight" ? RESIZE_STEP : -RESIZE_STEP));
        } else if (event.key === "Enter") {
          event.preventDefault();
          stop(event);
          onReset();
        }
      }}
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none before:absolute before:inset-y-1 before:right-0 before:w-0.5 before:rounded before:bg-transparent hover:before:bg-primary-600 focus-visible:outline-none focus-visible:before:bg-primary-600"
    />
  );
}
