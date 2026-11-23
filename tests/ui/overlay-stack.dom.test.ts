// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openOverlay, overlayCount, refreshOverlays, resetOverlaysForTests, topOverlay } from "@/features/ui/overlay-stack";

// v1.87.0 (D-417, gaps 10–12): the stack in a page (jsdom): only the top
// overlay hears Escape and outside clicks; a modal one makes the rest inert
// and locks scroll; releasing restores everything and focus.
beforeEach(() => {
  document.body.innerHTML = `<header id="top"><button id="opener">Open</button></header><main id="main"><p>page</p></main><div id="layer"></div><div data-testid="toast-region"></div>`;
});
afterEach(() => {
  resetOverlaysForTests();
  document.body.innerHTML = "";
});

function overlay(id: string) {
  const element = document.createElement("div");
  element.id = id;
  element.innerHTML = `<button id="${id}-a">a</button><button id="${id}-b">b</button>`;
  document.getElementById("layer")!.appendChild(element);
  return element;
}
const escape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

describe("one overlay stack", () => {
  it("sends Escape to the top overlay only, then to the next one", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const a = openOverlay({ element: overlay("pane"), kind: "pane", onEscape: lower });
    const b = openOverlay({ element: overlay("menu"), kind: "menu", onEscape: upper });
    escape();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
    b.release();
    escape();
    expect(lower).toHaveBeenCalledTimes(1);
    a.release();
    expect(overlayCount()).toBe(0);
  });

  it("an Escape already taken by a component (defaultPrevented) is left alone", () => {
    const onEscape = vi.fn();
    openOverlay({ element: overlay("pane"), kind: "pane", onEscape });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("a click outside reaches the top overlay only; its own button is ignored", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    openOverlay({ element: overlay("bell"), kind: "popover", onOutside: lower });
    const menu = overlay("menu");
    const opener = document.getElementById("opener")!;
    openOverlay({ element: menu, kind: "menu", onOutside: upper, ignore: (target) => target === opener });
    document.getElementById("menu-a")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(upper).not.toHaveBeenCalled();
    opener.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(upper).not.toHaveBeenCalled();
    document.getElementById("main")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("a modal overlay makes the rest inert and locks scroll; release undoes both", () => {
    const pane = overlay("pane");
    const handle = openOverlay({ element: pane, kind: "pane", modal: true });
    expect(document.getElementById("main")!.hasAttribute("inert")).toBe(true);
    expect(document.getElementById("top")!.hasAttribute("inert")).toBe(true);
    expect(pane.hasAttribute("inert")).toBe(false);
    expect(document.querySelector("[data-testid=toast-region]")!.hasAttribute("inert")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("hidden");
    handle.release();
    expect(document.querySelectorAll("[inert]").length).toBe(0);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("re-reads a pane's mode (side → dialog) on refresh", () => {
    let dialog = false;
    openOverlay({ element: overlay("pane"), kind: "pane", modal: () => dialog });
    expect(document.documentElement.style.overflow).toBe("");
    dialog = true;
    refreshOverlays();
    expect(document.documentElement.style.overflow).toBe("hidden");
  });

  it("keeps Tab inside a modal overlay", () => {
    const pane = overlay("pane");
    openOverlay({ element: pane, kind: "pane", modal: true });
    const last = document.getElementById("pane-b")!;
    // jsdom has no layout: treat every button as shown.
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get: () => document.body });
    last.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("pane-a");
  });

  it("is idempotent for the same element and gives focus back on release", () => {
    const opener = document.getElementById("opener")!;
    opener.focus();
    const element = overlay("sheet");
    const first = openOverlay({ element, kind: "sheet" });
    const again = openOverlay({ element, kind: "sheet" });
    expect(overlayCount()).toBe(1);
    expect(again.id).toBe(first.id);
    document.getElementById("sheet-a")!.focus();
    first.release();
    first.release();
    expect(overlayCount()).toBe(0);
    expect(document.activeElement).toBe(opener);
    expect(topOverlay()).toBeNull();
  });
});
