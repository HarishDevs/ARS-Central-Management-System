import { describe, expect, it } from "vitest";
import { menuMove, menuTypeahead } from "@/features/ui/menu-keys";

// v1.72.0 (D-387): the dropdown menu's keyboard moves.
describe("menuMove", () => {
  it("moves down and up, wrapping at both ends", () => {
    expect(menuMove(3, 0, "ArrowDown")).toBe(1);
    expect(menuMove(3, 2, "ArrowDown")).toBe(0);
    expect(menuMove(3, 0, "ArrowUp")).toBe(2);
    expect(menuMove(3, 1, "ArrowUp")).toBe(0);
  });
  it("starts from the first (down) or last (up) item when nothing has focus", () => {
    expect(menuMove(4, -1, "ArrowDown")).toBe(0);
    expect(menuMove(4, -1, "ArrowUp")).toBe(3);
  });
  it("jumps to the first and last item with Home and End", () => {
    expect(menuMove(5, 2, "Home")).toBe(0);
    expect(menuMove(5, 2, "End")).toBe(4);
  });
  it("ignores other keys and empty menus", () => {
    expect(menuMove(3, 1, "a")).toBeNull();
    expect(menuMove(0, -1, "ArrowDown")).toBeNull();
  });
});

describe("menuTypeahead", () => {
  const labels = ["Rename", "Set as default", "Make a copy", "Copy link", "Remove"];
  it("finds the next item starting with the letter, after the current one", () => {
    expect(menuTypeahead(labels, 0, "r")).toBe(4);
    expect(menuTypeahead(labels, 4, "R")).toBe(0);
    expect(menuTypeahead(labels, -1, "c")).toBe(3);
  });
  it("returns null when nothing matches", () => {
    expect(menuTypeahead(labels, 0, "z")).toBeNull();
  });
});
