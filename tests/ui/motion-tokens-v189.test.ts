import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { afterMotion, MOTION_DELAY, MOTION_DURATION, MOTION_EASE, MOTION_ROLE, motionMs } from "@/features/ui/motion";
import { MOTION_DURATION as SHELL_DURATION } from "@/features/shell/motion-rules";
import { findSettingDefinition } from "@/server/settings/definitions";
import tailwind from "../../tailwind.config";

// v1.89.0 (D-420): the owner's motion system. One token source in CSS
// (styles/globals.css :root), one TS mirror (features/ui/motion.ts), no other
// durations or easings in the app's interface code (illustrations, the brand
// loaders and the approval journey are the documented exceptions).
const root = process.cwd();
const css = fs.readFileSync(path.join(root, "styles/globals.css"), "utf8");
const rootBlock = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf("--motion-instant")));
const cssVar = (name: string) => new RegExp(`${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`).exec(rootBlock)?.[1]?.trim();
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}
const code = ["features", "app"].flatMap((dir) => walk(path.join(root, dir))).filter((file) => /\.(tsx?|css)$/.test(file));
const rel = (file: string) => path.relative(root, file).replace(/\\/g, "/");
// Illustration motion (not interface motion), kept with its own scene timings.
const ILLUSTRATIONS = /^features\/journey\//;

describe("motion tokens (D-420)", () => {
  it("CSS and the TS mirror have the owner's values", () => {
    expect(MOTION_DURATION).toEqual({ instant: 100, fast: 150, standard: 200, smooth: 250, emphasis: 300 });
    for (const [token, ms] of Object.entries(MOTION_DURATION)) expect(cssVar(`--motion-${token}`), token).toBe(`${ms}ms`);
    expect(MOTION_EASE.standard).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(MOTION_EASE.enter).toBe("cubic-bezier(0, 0, 0.2, 1)");
    expect(MOTION_EASE.exit).toBe("cubic-bezier(0.4, 0, 1, 1)");
    for (const ease of ["standard", "enter", "exit"] as const) expect(cssVar(`--ease-${ease}`), ease).toBe(MOTION_EASE[ease]);
    expect(cssVar("--motion-delay-tooltip")).toBe(`${MOTION_DELAY.tooltip}ms`);
    expect(cssVar("--motion-delay-loader")).toBe(`${MOTION_DELAY.loader}ms`);
    expect(cssVar("--motion-stagger-step")).toBe(`${MOTION_DELAY.staggerStep}ms`);
    // The shell's old import path is the same object.
    expect(SHELL_DURATION).toBe(MOTION_DURATION);
  });

  it("the roles are the owner's: page 200, modal and drawer 250, dropdown 150", () => {
    expect(MOTION_DURATION[MOTION_ROLE.page]).toBe(200);
    expect(MOTION_DURATION[MOTION_ROLE.dialogIn]).toBe(250);
    expect(MOTION_DURATION[MOTION_ROLE.drawerIn]).toBe(250);
    expect(MOTION_DURATION[MOTION_ROLE.dropdown]).toBe(150);
    expect(MOTION_DURATION[MOTION_ROLE.menu]).toBe(150);
    for (const [role, ref] of [["--motion-page", "standard"], ["--motion-dialog-in", "smooth"], ["--motion-drawer", "smooth"], ["--motion-menu", "fast"], ["--motion-dialog-out", "fast"], ["--motion-hover", "instant"], ["--motion-reduced", "instant"]]) expect(cssVar(role!), role).toBe(`var(--motion-${ref})`);
  });

  it("reduced motion makes every role 0 ms in code", () => {
    for (const role of Object.keys(MOTION_ROLE) as (keyof typeof MOTION_ROLE)[]) {
      expect(motionMs(role, true)).toBe(0);
      expect(motionMs(role, false)).toBe(MOTION_DURATION[MOTION_ROLE[role]]);
    }
    // No window (the server / this test): no reduce preference, a timer is set and can be cancelled.
    let ran = false;
    const cancel = afterMotion("toastOut", () => (ran = true));
    cancel();
    expect(ran).toBe(false);
  });

  it("retires the v1.87 names (base 220, moderate 280, slow 350, slower 450) everywhere", () => {
    expect(css).not.toMatch(/--motion-(base|moderate|slow|slower)\b/);
    const offenders = code.filter((file) => /--motion-(base|moderate|slow|slower)\b|\bduration-(base|moderate|slow|slower)\b|MOTION_DURATION\.(base|moderate|slow|slower)\b/.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("Tailwind's bare transition uses the tokens (DEFAULT) and offers only the new names", () => {
    const theme = (tailwind as { theme: { extend: { transitionDuration: Record<string, string>; transitionTimingFunction: Record<string, string> } } }).theme.extend;
    expect(theme.transitionDuration.DEFAULT).toBe("var(--motion-fast)");
    expect(theme.transitionTimingFunction.DEFAULT).toBe("var(--ease-standard)");
    expect(Object.keys(theme.transitionDuration).sort()).toEqual(["DEFAULT", "emphasis", "fast", "instant", "smooth", "standard"]);
  });

  it("has no hard-coded durations or easings in the interface code", () => {
    const literal = /\bduration-\d+\b|\bduration-\[|\bdelay-\d+\b|\bease-(in|out|in-out)\b|cubic-bezier\(|animate-\[|\[animation-delay:\d|\[transition-duration:\d/;
    const offenders = code
      .filter((file) => !ILLUSTRATIONS.test(rel(file)) && rel(file) !== "features/ui/motion.ts")
      .flatMap((file) =>
        fs
          .readFileSync(file, "utf8")
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => literal.test(line) && !line.trim().startsWith("//"))
          .map(({ index }) => `${rel(file)}:${index + 1}`),
      );
    expect(offenders).toEqual([]);
  });

  it("globals.css: interface motion is on the tokens (only the illustration and loader loops keep their own timings)", () => {
    const exempt = /\b(jr|brand)-|loader-slide|brand-shimmer|0\.01ms|jr-headvan|jr-fill/;
    const offenders = css
      .split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^\s*(animation|transition)(-duration|-timing-function|-delay)?:/.test(line) && /(\d+m?s\b|cubic-bezier\(|\bease(-in|-out|-in-out)?\b(?!-))/.test(line))
      .filter(({ line, index }) => !exempt.test(line) && !exempt.test(css.split("\n").slice(Math.max(0, index - 6), index).join("\n")))
      .map(({ line, index }) => `${index + 1}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });

  it("never animates width, height, top or left in the interface code", () => {
    const layout = /transition-\[[^\]]*\b(width|height|top|left|right|bottom)\b|transition:\s*(width|height|top|left)\b|transition-property:\s*[^;]*\b(width|height|top|left)\b/;
    const offenders = [...code.filter((file) => layout.test(fs.readFileSync(file, "utf8"))).map(rel), ...(layout.test(css) ? ["styles/globals.css"] : [])];
    expect(offenders).toEqual([]);
  });

  it("smooth scrolling in code respects reduced motion (UIQA-A11Y-03)", () => {
    const offenders = code.filter((file) => /behavior:\s*"smooth"/.test(fs.readFileSync(file, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("page transitions (D-420)", () => {
  const source = fs.readFileSync(path.join(root, "features/shell/PageTransitions.tsx"), "utf8");
  it("are on by default; the Super Admin switch stays as the kill switch", () => {
    const definition = findSettingDefinition("features.page_transitions");
    expect(definition?.defaultValue).toBe("ON");
    expect(definition?.group).toBe("FEATURES");
  });
  it("never hold the old picture longer than the slow-page limit, handle every promise, and skip Back / Forward", () => {
    expect(MOTION_DELAY.slowPage).toBe(300);
    expect(source).toContain("transition.ready.catch(");
    expect(source).toContain("transition.updateCallbackDone.catch(");
    expect(source).toContain("transition.finished");
    expect(source).not.toMatch(/setTimeout\(resolve, 4000\)/);
    expect(source).toMatch(/slow = window\.setTimeout\(end, SLOW_PAGE_MS\)/);
    expect(source).toMatch(/const onPop = \(\) => active\.current\?\.end\(\)/);
  });
  it("fade the old page out and the new page in with a 4 px rise (opacity and transform only)", () => {
    expect(css).toMatch(/::view-transition-old\(page-main\)\s*\{\s*animation: page-out var\(--motion-page-out\) var\(--ease-exit\) both;/);
    expect(css).toMatch(/::view-transition-new\(page-main\)\s*\{\s*animation: page-in var\(--motion-page\) var\(--ease-enter\) both;/);
    expect(css).toMatch(/@keyframes page-in \{\s*from \{\s*opacity: 0;\s*transform: translateY\(var\(--motion-distance-2\)\);/);
  });
});

describe("Motion Playground (D-420)", () => {
  const page = fs.readFileSync(path.join(root, "app/superadmin/dev/motion/page.tsx"), "utf8");
  it("is Super Admin only, with a static title and no generateMetadata (NAV-01)", () => {
    expect(page).toContain('await requireArea("superadmin")');
    expect(page).not.toContain("generateMetadata");
    expect(page).toMatch(/export const metadata: Metadata = \{ title: "Motion playground" \};/);
  });
  it("is not linked from any menu, the settings search or the code", () => {
    const linked = [...code, ...walk(path.join(root, "server")), ...walk(path.join(root, "lib"))].filter((file) => !rel(file).startsWith("app/superadmin/dev/") && rel(file) !== "features/superadmin/MotionPlayground.tsx" && /\/superadmin\/dev\/motion/.test(fs.readFileSync(file, "utf8")));
    expect(linked.map(rel)).toEqual([]);
  });
  it("draws its values from the one source", () => {
    const lab = fs.readFileSync(path.join(root, "features/superadmin/MotionPlayground.tsx"), "utf8");
    expect(lab).toContain('from "@/features/ui/motion"');
    expect(lab).not.toMatch(/\b\d{3}ms\b|duration-\d/);
  });
});
