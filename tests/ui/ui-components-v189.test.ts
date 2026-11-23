import fs from "node:fs";
import path from "node:path";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain ESM module without types (the ESLint config imports it).
import { arsUi } from "../../eslint-ui-rules.mjs";

// v1.89.0 stage 3b (D-422, UI unification batch 2): the control sizes, the
// button width, the type tokens and the touch sizes come from the tokens, and
// lint keeps them there.
const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const css = read("styles/globals.css");
const rule = (selector: string) => {
  const start = css.indexOf(`  ${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};

const lint = (code: string) => {
  const linter = new Linter({ configType: "flat" });
  return linter
    .verify(code, [{ files: ["**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { "ars-ui": arsUi }, rules: { "ars-ui/control-size": "error", "ars-ui/spacing-scale": "error", "ars-ui/type-scale": "error" } }], "x.tsx")
    .map((message) => message.ruleId);
};

describe("lint rules (D-422)", () => {
  it("blocks a fixed height beside a named control and allows h-auto / min-h", () => {
    expect(lint(`const a = <input className="field-input h-9" />;`)).toEqual(["ars-ui/control-size"]);
    expect(lint("const a = <button className={`btn-secondary btn-compact h-11 ${x}`} />;")).toEqual(["ars-ui/control-size"]);
    expect(lint(`const a = "pill-select h-[30px]";`)).toEqual(["ars-ui/control-size"]);
    expect(lint(`const a = <textarea className="field-input h-auto min-h-24 py-2" />;`)).toEqual([]);
    expect(lint(`const a = <input className="field-input field-compact w-40" />;`)).toEqual([]);
    expect(lint(`const a = <span className="h-9 w-9" />;`)).toEqual([]);
  });
  it("blocks arbitrary px / rem spacing, allows env() and calc()", () => {
    expect(lint(`const a = <div className="gap-[2px]" />;`)).toEqual(["ars-ui/spacing-scale"]);
    expect(lint(`const a = <div className="sm:pl-[3.75rem]" />;`)).toEqual(["ars-ui/spacing-scale"]);
    expect(lint(`const a = <div className="pb-[env(safe-area-inset-bottom)] pt-[22vh] gap-3" />;`)).toEqual([]);
  });
  it("retires text-title / text-card-title / text-greeting (not in a data-testid)", () => {
    expect(lint(`const a = <h2 className="text-card-title" />;`)).toEqual(["ars-ui/type-scale"]);
    expect(lint(`const a = <p className="sm:text-greeting" />;`)).toEqual(["ars-ui/type-scale"]);
    expect(lint(`const a = <input data-testid="text-title" className="text-section" />;`)).toEqual([]);
  });
});

describe("control classes (D-422)", () => {
  it("sizes btn-primary / -secondary / -danger to their words, btn-block opts in to full width", () => {
    for (const name of [".btn-primary", ".btn-secondary", ".btn-danger"]) {
      expect(rule(name)).toContain("w-auto");
      expect(rule(name)).not.toContain("w-full");
    }
    expect(rule(".btn-block")).toContain("w-full");
    expect(css.indexOf("  .btn-block {")).toBeGreaterThan(css.indexOf("  .btn-compact {"));
  });
  it("gives TaskGrid's inline editors and the round task checks 44 on touch screens only", () => {
    const coarse = css.slice(css.indexOf("@media (pointer: coarse) {"), css.indexOf("@keyframes toast-in"));
    expect(coarse).toMatch(/\.grid-editor \{\s*min-height: var\(--touch-min\);/);
    expect(coarse).toMatch(/\.task-check::before \{\s*inset: calc\(\(var\(--touch-min\) - 100%\) \/ -2\)/);
    expect(read("features/work/client.tsx")).toContain("task-check relative");
    expect(read("features/work/TaskGrid.tsx")).toContain("grid-editor rounded-full");
  });
  it("has one phone title (22 / 700) through the page-title token, and no .mob-screen-title", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 767.98px) {\n  :root {"));
    expect(phone.slice(0, 600)).toMatch(/--text-page-title: var\(--text-page-title-mobile\);[\s\S]*--text-page-title-weight: 700;/);
    expect(css).toMatch(/--text-page-title-mobile: 22px;/);
    expect(css).not.toMatch(/.mob-screen-titles*{/);
    expect(read("features/mobile/BottomSheet.tsx")).not.toContain("mob-screen-title");
  });
  it("has no fixed height beside field-input or btn-compact anywhere (CON-05 / CON-06)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name))
          read(rel).split("\n").forEach((line, index) => {
            for (const match of line.matchAll(/"[^"]*"|`[^`]*`|'[^']*'/g)) {
              const tokens = match[0].slice(1, -1).split(/\s+/);
              if ((tokens.includes("field-input") || tokens.includes("btn-compact")) && tokens.some((t) => /^(?:[\w-]+:)*h-(?:\d|\[)/.test(t))) offenders.push(`${rel}:${index + 1}`);
            }
          });
      }
    };
    walk("app");
    walk("features");
    expect(offenders).toEqual([]);
  });
});
