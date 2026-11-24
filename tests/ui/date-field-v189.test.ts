import fs from "node:fs";
import path from "node:path";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain ESM module without types (the ESLint config imports it).
import { arsUi } from "../../eslint-ui-rules.mjs";
import { DateField } from "@/features/ui/DateField";

// v1.89.0 stage 4 (D-426): the last 26 native date inputs (record forms, form-builder
// fields, the palette's filters, admin editors) use the shared picker; lint keeps it so.
const root = process.cwd();
const lint = (code: string) =>
  new Linter({ configType: "flat" })
    .verify(code, [{ files: ["**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { "ars-ui": arsUi }, rules: { "ars-ui/date-input": "error" } }], "x.tsx")
    .map((message) => message.ruleId);

describe("lint: ars-ui/date-input (D-426)", () => {
  it("blocks native date, date-time, month and week inputs", () => {
    expect(lint(`const a = <input type="date" name="d" />;`)).toEqual(["ars-ui/date-input"]);
    expect(lint(`const a = <input type="datetime-local" />;`)).toEqual(["ars-ui/date-input"]);
    expect(lint(`const a = <input type={"month"} />;`)).toEqual(["ars-ui/date-input"]);
  });
  it("allows time boxes and other inputs", () => {
    expect(lint(`const a = <input type="time" />;`)).toEqual([]);
    expect(lint(`const a = <input type="text" />;`)).toEqual([]);
  });
});

describe("no native date input left in app/ or features/", () => {
  it("finds none outside the shared picker", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx$/.test(entry.name) && /type=(["'{])\s*["']?(date|datetime-local)["']/.test(fs.readFileSync(path.join(root, rel), "utf8"))) found.push(rel);
      }
    };
    walk("app");
    walk("features");
    expect(found).toEqual([]);
  });
});

describe("DateField sends the same name and value as the native input it replaced", () => {
  const html = (props: Parameters<typeof DateField>[0]) => renderToString(createElement(DateField, props));
  it("a day: yyyy-mm-dd under the field's name", () => {
    const out = html({ id: "x-due", name: "dueDay", label: "Due date", defaultValue: "2026-12-01" });
    expect(out).toMatch(/name="dueDay"[^>]*value="2026-12-01"|value="2026-12-01"[^>]*name="dueDay"/);
    expect(out).toContain('id="x-due"');
    expect(out).toContain("Due date: Tuesday 1 December 2026. Change");
  });
  it("a day and a time: yyyy-mm-ddTHH:MM (the datetime-local format)", () => {
    const out = html({ id: "x-at", name: "due", label: "Due", withTime: true, defaultValue: "2026-12-01T17:30" });
    expect(out).toMatch(/value="2026-12-01T17:30"/);
    expect(out).toMatch(/id="x-at-time"[^>]*value="17:30"|value="17:30"[^>]*id="x-at-time"/);
  });
  it("empty and required: an empty named value the browser's check stops", () => {
    const out = html({ id: "x-req", name: "required_on", label: "Required date", required: true });
    expect(out).toMatch(/<input[^>]*name="required_on"[^>]*>/);
    const proxy = /<input[^>]*name="required_on"[^>]*>/.exec(out)![0];
    expect(proxy).toContain('required=""');
    expect(proxy).toContain('value=""');
  });
});
