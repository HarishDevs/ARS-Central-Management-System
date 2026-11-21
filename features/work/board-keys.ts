// v1.62.0 (D-368, spec PRJ views §3 Board, COMPONENT_SPECS §4 "Drag"): moving
// a Board card from the keyboard. Space lifts the focused card, the arrows
// move it between cards (↑ ↓) and columns (← →), Enter or Space drops it,
// Escape puts it back. Pure functions (tests/work/board-keys.test.ts).

export interface Lifted {
  taskId: number;
  col: number; // the column it would drop into
  index: number; // its place in that column (counted without the card itself)
  fromCol: number;
  fromIndex: number;
}

// `columns`: each column's card ids in the order shown.
export function lift(columns: readonly (readonly number[])[], taskId: number): Lifted | null {
  for (const [col, ids] of columns.entries()) {
    const index = ids.indexOf(taskId);
    if (index >= 0) return { taskId, col, index, fromCol: col, fromIndex: index };
  }
  return null;
}

const without = (ids: readonly number[], taskId: number) => ids.filter((id) => id !== taskId);

export function moveLifted(columns: readonly (readonly number[])[], state: Lifted, key: string): Lifted {
  if (key === "ArrowUp") return { ...state, index: Math.max(0, state.index - 1) };
  if (key === "ArrowDown") return { ...state, index: Math.min(without(columns[state.col] ?? [], state.taskId).length, state.index + 1) };
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const col = Math.min(columns.length - 1, Math.max(0, state.col + (key === "ArrowLeft" ? -1 : 1)));
    if (col === state.col) return state;
    return { ...state, col, index: Math.min(state.index, without(columns[col] ?? [], state.taskId).length) };
  }
  return state;
}

// The column's cards as shown while lifting (the lifted one at its new place).
export function previewColumn(ids: readonly number[], col: number, state: Lifted | null): number[] {
  if (!state) return [...ids];
  const rest = without(ids, state.taskId);
  if (col !== state.col) return rest;
  return [...rest.slice(0, state.index), state.taskId, ...rest.slice(state.index)];
}

// Where it drops: the card it goes before (null: the end of the column).
export function dropTarget(columns: readonly (readonly number[])[], state: Lifted): { col: number; beforeId: number | null; moved: boolean } {
  const rest = without(columns[state.col] ?? [], state.taskId);
  return { col: state.col, beforeId: rest[state.index] ?? null, moved: state.col !== state.fromCol || state.index !== state.fromIndex };
}

// What a screen reader hears.
export function positionText(columns: readonly (readonly number[])[], state: Lifted, columnName: string): string {
  const count = without(columns[state.col] ?? [], state.taskId).length + 1;
  return `Position ${state.index + 1} of ${count} in ${columnName}.`;
}

// Moving focus between cards when nothing is lifted: ↑ ↓ in the column, ← →
// to the nearest card of the next column that has cards.
export function focusNeighbour(columns: readonly (readonly number[])[], taskId: number, key: string): number | null {
  const at = lift(columns, taskId);
  if (!at) return null;
  const ids = columns[at.col] ?? [];
  if (key === "ArrowUp") return ids[at.index - 1] ?? null;
  if (key === "ArrowDown") return ids[at.index + 1] ?? null;
  if (key === "Home") return ids[0] ?? null;
  if (key === "End") return ids.at(-1) ?? null;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const step = key === "ArrowLeft" ? -1 : 1;
    for (let col = at.col + step; col >= 0 && col < columns.length; col += step) {
      const other = columns[col] ?? [];
      if (other.length) return other[Math.min(at.index, other.length - 1)]!;
    }
  }
  return null;
}
