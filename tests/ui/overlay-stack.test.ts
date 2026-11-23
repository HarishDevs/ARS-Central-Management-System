import { afterEach, describe, expect, it } from "vitest";
import { escapeTarget, isModal, needsScrollLock, outsideOfTop, overlayCount, resetOverlaysForTests, trapNext } from "@/features/ui/overlay-stack";

// v1.87.0 (D-417, gaps 10–12): the rules of the one overlay stack.
afterEach(() => resetOverlaysForTests());

const entry = (id: number, extra: Partial<{ native: boolean; onEscape: () => void; escapeWhileTyping: boolean }> = {}) => ({ id, onEscape: () => undefined, ...extra });

describe("escapeTarget: Escape reaches the top overlay only", () => {
  it("is nobody with no overlay", () => {
    expect(escapeTarget([], false, false)).toBeNull();
  });
  it("is the top entry, not the one below", () => {
    expect(escapeTarget([entry(1), entry(2)], false, false)).toBe(2);
  });
  it("leaves a native modal dialog on top to the browser", () => {
    expect(escapeTarget([entry(1), entry(2, { native: true })], false, false)).toBeNull();
  });
  it("does nothing when an unregistered modal dialog is above the stack", () => {
    expect(escapeTarget([entry(1)], false, true)).toBeNull();
  });
  it("lets a pane ignore Escape while the person types (the editor keeps it)", () => {
    expect(escapeTarget([entry(1, { escapeWhileTyping: false })], true, false)).toBeNull();
    expect(escapeTarget([entry(1, { escapeWhileTyping: false })], false, false)).toBe(1);
    expect(escapeTarget([entry(1)], true, false)).toBe(1);
  });
  it("skips an entry that takes no Escape", () => {
    expect(escapeTarget([{ id: 3 }], false, false)).toBeNull();
  });
});

describe("outsideOfTop", () => {
  const box = { contains: (node: unknown) => node === "inside" };
  it("is true only for a target outside the top overlay", () => {
    expect(outsideOfTop(box, "outside", false)).toBe(true);
    expect(outsideOfTop(box, "inside", false)).toBe(false);
  });
  it("is false for an ignored target (the opening button) or no overlay", () => {
    expect(outsideOfTop(box, "outside", true)).toBe(false);
    expect(outsideOfTop(null, "outside", false)).toBe(false);
  });
});

describe("trapNext: Tab stays inside a modal overlay", () => {
  const items = ["a", "b", "c"];
  it("wraps from the last to the first and back", () => {
    expect(trapNext(items, "c", false)).toBe("a");
    expect(trapNext(items, "a", true)).toBe("c");
  });
  it("leaves the browser to move inside (null)", () => {
    expect(trapNext(items, "a", false)).toBeNull();
    expect(trapNext(items, "c", true)).toBeNull();
  });
  it("pulls focus in from outside", () => {
    expect(trapNext(items, null, false)).toBe("a");
    expect(trapNext(items, "x", true)).toBe("c");
    expect(trapNext([], null, false)).toBeNull();
  });
});

describe("modal and scroll lock", () => {
  it("a native dialog is not 'modal' for the stack (the browser handles it) but locks scroll", () => {
    expect(isModal({ native: true, modal: true })).toBe(false);
    expect(needsScrollLock([{ native: true }])).toBe(true);
  });
  it("reads a function (a pane that switches between side and dialog)", () => {
    let dialog = false;
    const pane = { modal: () => dialog };
    expect(isModal(pane)).toBe(false);
    expect(needsScrollLock([pane])).toBe(false);
    dialog = true;
    expect(isModal(pane)).toBe(true);
    expect(needsScrollLock([pane])).toBe(true);
  });
  it("starts empty in tests", () => {
    expect(overlayCount()).toBe(0);
  });
});
