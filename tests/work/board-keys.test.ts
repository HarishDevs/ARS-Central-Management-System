import { describe, expect, it } from "vitest";
import { dropTarget, focusNeighbour, lift, moveLifted, positionText, previewColumn } from "@/features/work/board-keys";

// v1.62.0 (D-368): moving a Board card from the keyboard.
const columns = [
  [1, 2, 3],
  [],
  [4, 5],
];

describe("board keyboard move", () => {
  it("lifts a card where it is", () => {
    expect(lift(columns, 2)).toEqual({ taskId: 2, col: 0, index: 1, fromCol: 0, fromIndex: 1 });
    expect(lift(columns, 99)).toBeNull();
  });

  it("moves up and down inside the column, not past the ends", () => {
    const start = lift(columns, 2)!;
    expect(moveLifted(columns, start, "ArrowUp").index).toBe(0);
    expect(moveLifted(columns, moveLifted(columns, start, "ArrowUp"), "ArrowUp").index).toBe(0);
    const down = moveLifted(columns, moveLifted(columns, start, "ArrowDown"), "ArrowDown");
    expect(down.index).toBe(2); // after card 3, the end of the column
  });

  it("moves across columns (an empty one too) and keeps a place inside the new column", () => {
    const start = lift(columns, 3)!; // index 2
    const right = moveLifted(columns, start, "ArrowRight");
    expect(right).toMatchObject({ col: 1, index: 0 });
    const further = moveLifted(columns, right, "ArrowRight");
    expect(further).toMatchObject({ col: 2, index: 0 });
    expect(moveLifted(columns, further, "ArrowRight")).toBe(further);
    expect(previewColumn(columns[2]!, 2, further)).toEqual([3, 4, 5]);
    expect(previewColumn(columns[0]!, 0, further)).toEqual([1, 2]);
  });

  it("drops before the card at its place, or at the end", () => {
    const start = lift(columns, 1)!;
    expect(dropTarget(columns, start)).toEqual({ col: 0, beforeId: 2, moved: false });
    const end = moveLifted(columns, moveLifted(columns, start, "ArrowDown"), "ArrowDown");
    expect(dropTarget(columns, end)).toEqual({ col: 0, beforeId: null, moved: true });
    const across = moveLifted(columns, moveLifted(columns, start, "ArrowRight"), "ArrowRight");
    expect(dropTarget(columns, across)).toEqual({ col: 2, beforeId: 4, moved: true });
  });

  it("announces the position", () => {
    const start = lift(columns, 2)!;
    expect(positionText(columns, start, "To do")).toBe("Position 2 of 3 in To do.");
    const across = moveLifted(columns, start, "ArrowRight");
    expect(positionText(columns, across, "Doing")).toBe("Position 1 of 1 in Doing.");
  });

  it("moves focus between cards and skips empty columns", () => {
    expect(focusNeighbour(columns, 2, "ArrowDown")).toBe(3);
    expect(focusNeighbour(columns, 1, "ArrowUp")).toBeNull();
    expect(focusNeighbour(columns, 3, "ArrowRight")).toBe(5);
    expect(focusNeighbour(columns, 4, "ArrowLeft")).toBe(1);
    expect(focusNeighbour(columns, 2, "End")).toBe(3);
    expect(focusNeighbour(columns, 3, "Home")).toBe(1);
  });
});
