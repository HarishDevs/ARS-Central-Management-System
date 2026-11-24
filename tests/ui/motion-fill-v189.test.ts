import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// v1.89.0 (D-424): an entry animation must not keep its last frame after it
// ends. `animation-fill-mode: both` (or forwards) leaves translate / scale /
// transform applied, which makes the element the containing block of every
// position: fixed descendant (menus, pickers, sheets drawn off screen).
const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");

// Keyframes whose name says they bring something in.
const ENTRY = /^(toast-in|auth-enter|mob-sheet-in|picbot-grow|fold-reveal|page-in|menu-in|value-changed|motion-(fade|slide-up|slide-down|slide-left|scale|expand))$/;

describe("entry animations fill backwards only (D-424)", () => {
  const rules = [...css.matchAll(/([^{};]*)\{[^{}]*?(animation:\s*([\w-]+)\s+[^;]*;)/g)].map((match) => ({ selector: match[1]!.trim(), name: match[3]!, text: match[2]! }));
  // View-transition pseudo-elements live only during the transition (no descendants), so they may hold.
  const entries = rules.filter((rule) => ENTRY.test(rule.name) && !rule.selector.includes("::view-transition"));

  it("finds the entry animations", () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it("none of them keeps its last frame (no both / forwards)", () => {
    const keeping = entries.filter((rule) => /\b(both|forwards)\b/.test(rule.text)).map((rule) => rule.text);
    expect(keeping).toEqual([]);
  });

  it("exits still hold their last frame until removed", () => {
    for (const exit of ["page-out", "toast-out", "picbot-shrink", "motion-sheet-out", "motion-fade-out"]) {
      const rule = rules.find((item) => item.name === exit);
      expect(rule?.text, exit).toMatch(/\bboth\b/);
    }
  });
});
