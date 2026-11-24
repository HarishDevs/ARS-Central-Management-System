// v1.80.0 (D-407): contrast of the theme's token pairs (WCAG 2.2 AA:
// text 4.5:1, UI edges and icons 3:1), read from styles/globals.css for the
// light (:root) and dark (:root[data-theme="dark"]) blocks.
// Run: node scripts/qa/token-contrast.mjs  (exits 1 when a pair fails)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");
function block(selector) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const tokens = {};
  for (const match of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) tokens[match[1]] = match[2];
  return tokens;
}
const hex = (value) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
const lum = (value) => {
  const [r, g, b] = hex(value).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const TEXT = ["text-primary", "text-secondary", "text-placeholder", "primary-600", "primary-700", "success-600", "warning-600", "error-600", "info-600"];
const SURFACES = ["surface-white", "surface-muted", "surface-page", "surface-raised", "row-active"];
const pairs = [];
// v1.89.0 (D-424, A11Y-04): status text is checked on the open / selected row
// too (the Task Summary due date sits on row-active as plain text, not in a pill).
for (const text of TEXT) for (const surface of SURFACES) pairs.push([text, surface, 4.5]);
for (const surface of ["surface-white", "surface-muted", "surface-page"]) pairs.push(["border-input", surface, 3]);
pairs.push(["text-on-solid", "primary-solid", 4.5], ["text-primary", "primary-50", 4.5], ["primary-700", "primary-50", 4.5], ["text-secondary", "primary-50", 4.5]);

let failed = 0;
for (const [theme, selector] of [["light", ":root"], ["dark", ':root[data-theme="dark"]']]) {
  const light = block(":root");
  const tokens = theme === "light" ? light : { ...light, ...block(selector) };
  console.log(`\n${theme}`);
  for (const [fg, bg, need] of pairs) {
    const a = tokens[`color-${fg}`];
    const b = tokens[`color-${bg}`];
    if (!a || !b) continue;
    const value = ratio(a, b);
    const ok = value >= need;
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${fg} on ${bg}: ${value.toFixed(2)}:1 (needs ${need})`);
  }
}
if (failed) {
  console.log(`\n${failed} pair(s) below AA`);
  process.exit(1);
}
