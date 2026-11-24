import fs from "node:fs";
import path from "node:path";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain ESM module without types (the ESLint config imports it).
import { arsUi } from "../../eslint-ui-rules.mjs";
import { RelativeTime } from "@/features/ui/RelativeTime";

// v1.89.0 stage 3e (D-425, UI unification batch 5: content): one date formatter, kept by lint;
// relative times only in the browser (ERR-01).
const root = process.cwd();

const lint = (code: string) =>
  new Linter({ configType: "flat" })
    .verify(code, [{ files: ["**/*.tsx"], languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } }, plugins: { "ars-ui": arsUi }, rules: { "ars-ui/date-format": "error" } }], "x.tsx")
    .map((message) => message.ruleId);

describe("lint: ars-ui/date-format (D-425)", () => {
  it("blocks the browser's date formatting", () => {
    expect(lint(`const a = new Date().toLocaleDateString("en-IN");`)).toEqual(["ars-ui/date-format"]);
    expect(lint(`const a = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit" });`)).toEqual(["ars-ui/date-format"]);
    expect(lint(`const a = new Intl.DateTimeFormat("en-IN", { day: "numeric" });`)).toEqual(["ars-ui/date-format"]);
    expect(lint(`const a = new Intl.RelativeTimeFormat("en-GB");`)).toEqual(["ars-ui/date-format"]);
    expect(lint(`const a = new Date(x).toLocaleString("en-IN");`)).toEqual(["ars-ui/date-format"]);
    expect(lint(`const a = (d: Date) => d.toLocaleString("en-IN", { month: "short", timeZone: "Asia/Kolkata" });`)).toEqual(["ars-ui/date-format"]);
  });
  it("allows figures (a number's toLocaleString)", () => {
    expect(lint(`const a = (5000).toLocaleString("en-IN");`)).toEqual([]);
    expect(lint(`const a = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });`)).toEqual([]);
  });
});

describe("no ad-hoc date formatting left (CON-08)", () => {
  it("app/, features/ and server/ call no toLocale*Date / Intl date formatter outside the two documented exceptions", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          fs.readFileSync(path.join(root, rel), "utf8")
            .split("\n")
            .forEach((line, index) => {
              if (/toLocaleDateString|toLocaleTimeString|Intl\.DateTimeFormat|RelativeTimeFormat/.test(line)) found.push(`${rel}:${index + 1}`);
            });
        }
      }
    };
    ["app", "features", "server"].forEach(walk);
    // server/calendar/config.ts checks a zone name; server/reports/export.ts keeps report-file cells unchanged (D-425).
    expect(found.filter((at) => !/^server\/(calendar\/config|reports\/export)\.ts:/.test(at))).toEqual([]);
  });
});

describe("<RelativeTime> (ERR-01)", () => {
  it("renders the absolute India time on the server (never 'ago')", () => {
    const html = renderToString(createElement(RelativeTime, { at: "2026-11-24T09:35:00Z" }));
    expect(html).toContain("24 Nov 2026, 3:05 pm");
    expect(html).toContain('dateTime="2026-11-24T09:35:00.000Z"');
    expect(html).toContain('data-relative="pending"');
    expect(html).not.toMatch(/ago|Yesterday|Today/);
  });
  it("a day renders as the date, kept as the day", () => {
    const html = renderToString(createElement(RelativeTime, { at: "2026-11-24", kind: "day" }));
    expect(html).toContain(">24 Nov 2026<");
    expect(html).toContain('dateTime="2026-11-24"');
  });
  it("nothing for no date", () => {
    expect(renderToString(createElement(RelativeTime, { at: null }))).toBe("");
  });
});
