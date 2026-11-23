import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initialSidebar, sidebarWidthClass } from "@/features/shell/sidebar-cookie";
import tailwind from "../../tailwind.config";

// v1.89.0 stage 3a (D-421): the owner's reference dimensions are tokens in one
// place (styles/globals.css :root, phones in the media block under it) and
// Tailwind reads them; the shell and the control classes use only the tokens.
const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const css = read("styles/globals.css");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));
const cssVar = (block: string, name: string) => new RegExp(`${name.replace(/-/g, "\\-")}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
const phoneBlock = (() => {
  const start = css.indexOf("@media (max-width: 767.98px) {\n  :root {");
  return css.slice(start, css.indexOf("}\n}", start));
})();
const rule = (selector: string) => {
  const start = css.indexOf(`  ${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};

describe("shell and control tokens (D-421)", () => {
  it("has the owner's reference values", () => {
    const expected: Record<string, string> = {
      "--header-h": "64px",
      "--header-h-mobile": "56px",
      "--sidebar-w": "250px",
      "--sidebar-w-rail": "72px",
      "--page-px": "24px",
      "--page-pt": "24px",
      "--section-gap": "24px",
      "--content-max": "1600px",
      "--control-h-sm": "32px",
      "--control-h-md": "40px",
      "--control-h-lg": "48px",
      "--input-h": "42px",
      "--input-h-sm": "32px",
      "--text-page-title": "24px",
      "--text-section": "18px",
      "--text-body": "14px",
      "--radius-card": "12px",
      "--radius-modal": "16px",
    };
    for (const [name, value] of Object.entries(expected)) expect(cssVar(rootBlock, name), name).toBe(value);
    for (const [step, px] of [[1, 4], [2, 8], [3, 12], [4, 16], [5, 20], [6, 24], [8, 32], [10, 40], [12, 48]]) expect(cssVar(rootBlock, `--space-${step}`)).toBe(`${px}px`);
  });

  it("phones (below 768) use one 56 px header and 16 px padding in every area", () => {
    expect(phoneBlock).not.toBe("");
    expect(cssVar(phoneBlock, "--header-h")).toBe("var(--header-h-mobile)");
    expect(cssVar(phoneBlock, "--page-px")).toBe("16px");
    expect(cssVar(phoneBlock, "--page-pt")).toBe("16px");
  });

  it("Tailwind maps the tokens (no fixed shell numbers)", () => {
    const theme = tailwind.theme!.extend! as Record<string, Record<string, unknown>>;
    expect(theme.spacing).toMatchObject({ sidebar: "var(--sidebar-w)", rail: "var(--sidebar-w-rail)", topbar: "var(--header-h)", page: "var(--page-px)", "page-top": "var(--page-pt)", section: "var(--section-gap)", "control-md": "var(--control-h-md)", input: "var(--input-h)" });
    expect(theme.maxWidth).toMatchObject({ content: "var(--content-max)" });
    expect((theme.fontSize as Record<string, string[]>)["page-title"]![0]).toContain("var(--text-page-title)");
    expect((theme.fontSize as Record<string, string[]>).section![0]).toContain("var(--text-section)");
  });

  it("the control classes use only the named sizes, and touch screens get 44 for every one", () => {
    for (const selector of [".btn-primary", ".btn-secondary", ".btn-danger", ".btn-danger-quiet"]) expect(rule(selector), selector).toContain("h-control-md");
    for (const selector of [".btn-compact", ".btn-ghost", ".tb-btn", ".tb-split", ".pill-select"]) expect(rule(selector), selector).toContain("h-control-sm");
    expect(rule(".field-input")).toContain("h-input ");
    expect(rule(".field-compact")).toContain("h-input-sm");
    expect(css).not.toMatch(/h-\[46px\]/);
    // The size modifiers come after every variant (btn-danger btn-compact is the sm size).
    expect(css.indexOf("  .btn-compact {")).toBeGreaterThan(css.indexOf("  .btn-danger-quiet {"));
    expect(css.indexOf("  .btn-compact {")).toBeGreaterThan(css.indexOf("  .btn-ghost {"));
    const coarse = css.slice(css.indexOf("@media (pointer: coarse) {"), css.indexOf("}\n}", css.indexOf("@media (pointer: coarse) {")));
    for (const name of ["btn-primary", "btn-compact", "btn-ghost", "tb-btn", "pill-select", "field-input"]) expect(coarse, name).toContain(`.${name}`);
    expect(coarse).toContain("var(--touch-min)");
  });

  it("LAY-01: main wraps a long word anywhere; PageHeader lets the title shrink", () => {
    expect(css).toMatch(/main \{\n {2}overflow-wrap: anywhere;/);
    const header = read("features/shell/PageHeader.tsx");
    expect(header).toMatch(/<h1 className="[^"]*min-w-0[^"]*\[overflow-wrap:anywhere\]/);
    expect(header).toContain("text-page-title");
    expect(header).toContain("mb-section");
  });

  it("the shell reads the tokens: header, sidebar, content (left-aligned, 1600), Classic unchanged", () => {
    const shell = read("features/shell/AppShell.tsx");
    expect(shell).toContain("h-topbar items-center justify-between gap-4 border-b border-line bg-surface px-page");
    expect(shell).toContain("w-full max-w-content flex-1 px-page pt-page");
    expect(shell).toContain("h-[calc(var(--header-h)+env(safe-area-inset-top))]");
    // Only the Classic branch keeps the centred 1280 box.
    expect(shell.match(/max-w-7xl/g)?.length).toBe(1);
    expect(shell).toMatch(/classic\s*\?\s*`mx-auto w-full max-w-7xl/);
    const frame = read("features/shell/SidebarFrame.tsx");
    expect(frame).toContain('collapsed ? "w-rail" : "w-sidebar"');
    expect(frame).not.toContain("w-20");
  });
});

describe("tablet rail by default (D-421, UIQA-RESP-02)", () => {
  it("classes widths: 768-1279 is a tablet", () => {
    expect(sidebarWidthClass(767)).toBe("wide"); // phones have no sidebar
    expect(sidebarWidthClass(768)).toBe("tablet");
    expect(sidebarWidthClass(1024)).toBe("tablet");
    expect(sidebarWidthClass(1279)).toBe("tablet");
    expect(sidebarWidthClass(1280)).toBe("wide");
    expect(sidebarWidthClass(1920)).toBe("wide");
  });
  it("the saved choice always wins; with none, a tablet starts folded", () => {
    expect(initialSidebar("rail", "wide")).toEqual({ collapsed: true, saved: true });
    expect(initialSidebar("open", "tablet")).toEqual({ collapsed: false, saved: true });
    expect(initialSidebar(undefined, "tablet")).toEqual({ collapsed: true, saved: false });
    expect(initialSidebar(undefined, "wide")).toEqual({ collapsed: false, saved: false });
    // The width is not known yet (a device's first page): both drawn, CSS picks (no layout shift).
    expect(initialSidebar(undefined, undefined)).toEqual({ collapsed: null, saved: false });
    expect(initialSidebar(undefined, "junk")).toEqual({ collapsed: null, saved: false });
    expect(initialSidebar("junk", "tablet")).toEqual({ collapsed: true, saved: false });
  });
});

describe("the first page on a device draws the right sidebar with CSS (no layout shift)", () => {
  it("auto state: rail below xl (1280), open from xl, both drawn until the effect picks one", () => {
    const frame = fs.readFileSync(path.join(process.cwd(), "features/shell/SidebarFrame.tsx"), "utf8");
    expect(frame).toContain('auto ? "w-rail xl:w-sidebar"');
    expect(frame).toContain('{auto && <div className="hidden min-h-0 flex-1 flex-col xl:flex">{children}</div>}');
    expect(frame).toMatch(/auto \? "xl:hidden" : ""/);
  });
});
