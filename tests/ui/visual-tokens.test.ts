import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// v1.72.2 (D-394, QA visual review): guards for the one layer scale, the
// shared field class and the token contrast fixes.
const root = path.resolve(__dirname, "../..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}
const files = [...sources(path.join(root, "features")), ...sources(path.join(root, "app"))];
const css = readFileSync(path.join(root, "styles/globals.css"), "utf8");
const cssVar = (name: string) => {
  const match = css.match(new RegExp(`${name}:\\s*(-?\\d+|#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`${name} not found`);
  return match[1]!;
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("visual tokens", () => {
  it("page-level layers use the named z-index scale, never raw values", () => {
    const raw = /(^|[^a-z-])z-(20|30|40|50)\b|z-\[\d{2,}\]|zIndex:\s*\d{2,}/;
    const offenders = files.filter((file) => raw.test(readFileSync(file, "utf8"))).map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  it("the layers are in order: sticky < drawer < popover < dialog < toast < palette < splash", () => {
    const order = ["--z-header", "--z-sticky", "--z-drawer", "--z-popover", "--z-dialog", "--z-toast", "--z-palette", "--z-splash"].map((name) => Number(cssVar(name)));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it("no control uses the missing .input class", () => {
    const offenders = files.filter((file) => /className=["`{]+input[\s"`]/.test(readFileSync(file, "utf8"))).map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });

  it("faint text reaches 4.5:1 on muted and selected rows, and field edges 3:1 (light theme)", () => {
    const faint = cssVar("--color-text-placeholder");
    expect(contrast(faint, cssVar("--color-surface-muted"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(faint, cssVar("--color-row-active"))).toBeGreaterThanOrEqual(4.5);
    const edge = cssVar("--color-border-input");
    for (const surface of ["--color-surface-white", "--color-surface-page", "--color-surface-muted"]) expect(contrast(edge, cssVar(surface))).toBeGreaterThanOrEqual(3);
  });
});
