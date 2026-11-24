import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { IDS_FILE, OUT, ROLES, VIEWPORTS, loadIds, moduleOf, routesFor, settle, setUpRecords, signIn, webkitHttpsShim, type RoleKey, type Viewport } from "./ui-qa-shared";

// UI/UX QA audit, phase 1 (docs/qa/QA_TEST_PLAN.md): the measured geometry
// sweep. For every route of each role at each viewport it records the shell
// geometry (header, sidebar, main offsets, padding, max-width), type (h1, h2,
// body), control sizes (buttons, inputs by class), card radius, page overflow
// and elements outside the viewport, date/number formats in the text, console
// and page errors, failed requests, navigation timing and layout shift, axe
// (wcag2a, wcag2aa, wcag21aa, wcag22aa) at the axe viewports, and a viewport
// screenshot. Never fails on a finding: evidence only (audit/ui-qa/raw/*.json).
//
// Chunking (env):
//   UIQA=1            required (skipped otherwise: never part of the e2e run)
//   UIQA_ROLES        e.g. "user,approver" (default: all)
//   UIQA_VP           e.g. "1440x900,390x844" (default: all nine)
//   UIQA_AXE_VP       viewports that also run axe (default "1440x900,390x844")
//   UIQA_RAIL=1       also the collapsed sidebar (ars_sidebar=rail) at the desktop viewports, on a sample
//   UIQA_SHOTS=0      no screenshots
test.skip(!process.env.UIQA, "UI QA audit: run only with UIQA=1 (docs/qa/QA_TEST_PLAN.md)");
test.describe.configure({ mode: "serial" });

const pick = <T extends string>(env: string | undefined, all: readonly T[]) => (env ? env.split(",").map((s) => s.trim()).filter((s): s is T => (all as readonly string[]).includes(s)) : [...all]);
const roleKeys = pick(process.env.UIQA_ROLES, Object.keys(ROLES) as RoleKey[]);
const vpNames = pick(process.env.UIQA_VP, VIEWPORTS.map((v) => v.name));
const axeVps = (process.env.UIQA_AXE_VP ?? "1440x900,390x844").split(",");
const shots = process.env.UIQA_SHOTS !== "0";
// v1.89.0 (D-424): UIQA_THEME=dark sweeps the dark theme (results under "<browser>-dark").
const THEME_SUFFIX = process.env.UIQA_THEME === "dark" ? "-dark" : "";
const IGNORED_CONSOLE = [/Download the React DevTools/, /favicon/i, /net::ERR_ABORTED/];

test("set up: records for the detail routes (once per database)", async ({ page, context }) => {
  test.setTimeout(400_000);
  if (fs.existsSync(IDS_FILE) && !process.env.UIQA_SETUP_DATA) test.skip(true, "ids.json exists");
  await setUpRecords(page, context);
});

function slug(p: string) {
  return p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 90) || "root";
}

// Everything measured inside the page (one evaluate per visit).
async function measure(page: Page) {
  return page.evaluate(() => {
    const px = (v: string) => Math.round(parseFloat(v) * 10) / 10;
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.01 && (el as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
    };
    const hist = (values: number[]) => {
      const out: Record<string, number> = {};
      for (const v of values) out[String(Math.round(v))] = (out[String(Math.round(v))] ?? 0) + 1;
      return out;
    };
    const describe = (el: Element) => {
      const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const testId = el.getAttribute("data-testid");
      const where = el.closest("[data-testid]")?.getAttribute("data-testid");
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".");
      return `${el.tagName.toLowerCase()}${testId ? `[${testId}]` : ""}${cls ? `.${cls}` : ""}${!testId && where ? ` in [${where}]` : ""} "${text}"`;
    };
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const header = [...document.querySelectorAll("header")].find((el) => visible(el) && el.getBoundingClientRect().top <= 1 && !el.closest("main"));
    const sidebar = document.querySelector('[data-testid="sidebar"]');
    const main = document.querySelector("main");
    const mainStyle = main ? getComputedStyle(main) : null;
    const mainBox = main?.getBoundingClientRect();
    const firstChild = main ? [...main.children].find((el) => visible(el)) : undefined;
    const h1s = [...document.querySelectorAll("h1")].filter(visible);
    const h1 = (main ? [...main.querySelectorAll("h1")].find(visible) : undefined) ?? h1s[0];
    const h1Style = h1 ? getComputedStyle(h1) : null;
    const scope = main ?? document.body;
    const h2s = [...scope.querySelectorAll("h2")].filter(visible).map((el) => px(getComputedStyle(el).fontSize));
    const paras = [...scope.querySelectorAll("p, td, li")].filter(visible).map((el) => px(getComputedStyle(el).fontSize));
    const kind = (el: Element, kinds: [string, string][]) => {
      const cls = el.getAttribute("class") ?? "";
      for (const [needle, name] of kinds) if (cls.split(/\s+/).includes(needle)) return name;
      return "other";
    };
    const btnKinds: [string, string][] = [["btn-compact", "btn-compact"], ["btn-primary", "btn-primary"], ["btn-secondary", "btn-secondary"], ["btn-danger", "btn-danger"], ["btn-danger-quiet", "btn-danger-quiet"], ["btn-ghost", "btn-ghost"], ["tb-btn", "tb-btn"]];
    const buttons: Record<string, number[]> = {};
    for (const el of scope.querySelectorAll('button, a[class*="btn-"], [role="button"], summary[class*="btn"], summary.tb-btn')) {
      if (!visible(el)) continue;
      const k = kind(el, btnKinds);
      const h = el.getBoundingClientRect().height;
      // "other" buttons: only those that look like buttons (a border or a fill), not icon or text links.
      if (k === "other") {
        const s = getComputedStyle(el);
        const filled = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
        if (!filled && s.borderTopWidth === "0px") continue;
      }
      (buttons[k] ??= []).push(h);
    }
    const inputKinds: [string, string][] = [["field-compact", "field-compact"], ["pill-select", "pill-select"], ["field-input", "field-input"]];
    const inputs: Record<string, number[]> = {};
    for (const el of scope.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]):not([type="range"]):not([type="color"]), select')) {
      if (!visible(el)) continue;
      const k = `${el.tagName === "SELECT" ? "select" : "input"}:${kind(el, inputKinds)}`;
      (inputs[k] ??= []).push(el.getBoundingClientRect().height);
    }
    const cards = [...scope.querySelectorAll(".card, .card-link")].filter(visible).map((el) => px(getComputedStyle(el).borderTopLeftRadius));
    // Box-like surfaces that are not .card (bordered, a background, sizeable): their radius.
    const boxes: number[] = [];
    for (const el of scope.querySelectorAll("div, section, article, li, aside")) {
      if (el.classList.contains("card") || el.classList.contains("card-link")) continue;
      const s = getComputedStyle(el);
      if (s.borderTopWidth === "0px" || s.borderTopStyle === "none") continue;
      const box = el.getBoundingClientRect();
      if (box.width < 160 || box.height < 60) continue;
      boxes.push(px(s.borderTopLeftRadius));
      if (boxes.length > 300) break;
    }
    // Overflow and elements outside the viewport (not clipped by a scrolling or hidden ancestor, not fixed off-screen on purpose).
    const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const clippedByAncestor = (el: Element) => {
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const ox = getComputedStyle(node).overflowX;
        if (ox !== "visible") {
          const nb = node.getBoundingClientRect();
          if (nb.right <= vw + 1 && nb.left >= -1) return true;
        }
      }
      return false;
    };
    const outside: string[] = [];
    let outsideCount = 0;
    for (const el of document.querySelectorAll("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      if (box.right <= vw + 1 && box.left >= -1) continue;
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      if (s.position === "fixed" && (box.left >= vw || box.right <= 0)) continue; // parked off-canvas
      if (el.closest(".sr-only")) continue;
      if (clippedByAncestor(el)) continue;
      outsideCount += 1;
      // Only the outermost offender of a subtree.
      if (outside.length < 6 && !outside.some((d) => d === describe(el))) {
        const parentBox = el.parentElement?.getBoundingClientRect();
        if (!parentBox || parentBox.right <= vw + 1) outside.push(`${describe(el)} [${Math.round(box.left)}..${Math.round(box.right)}]`);
      }
    }
    // Text formats seen on the page (dates, money, numbers).
    const text = (main?.innerText ?? document.body.innerText).slice(0, 60_000);
    const count = (re: RegExp) => (text.match(re) ?? []).length;
    const formats = {
      "d Mon yyyy": count(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/g),
      "d Mon (no year)": count(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?! \d{4})/g),
      "Mon d, yyyy": count(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/g),
      "dd/mm/yyyy": count(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g),
      "dd-mm-yyyy": count(/\b\d{1,2}-\d{1,2}-\d{4}\b/g),
      "yyyy-mm-dd": count(/\b\d{4}-\d{2}-\d{2}\b/g),
      "12h time": count(/\b\d{1,2}:\d{2}\s?(am|pm|AM|PM)\b/g),
      "24h time": count(/\b([01]?\d|2[0-3]):[0-5]\d\b(?!\s?(am|pm|AM|PM))/g),
      "relative (ago/in)": count(/\b\d+\s?(s|sec|min|m|h|hr|hours?|days?|d|weeks?|w)\s+ago\b|\bjust now\b|\byesterday\b/gi),
      "₹": count(/₹/g),
      "Rs/INR": count(/\b(Rs\.?|INR)\s?\d/g),
      "Indian grouping 1,00,000": count(/\b\d{1,2},\d{2},\d{3}\b/g),
      "Western grouping 100,000": count(/\b\d{3},\d{3}\b/g),
    };
    const fontSizes = hist([...scope.querySelectorAll("*")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())).slice(0, 2500).map((el) => parseFloat(getComputedStyle(el).fontSize)));
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    // v1.89.0 (D-422): the list toolbar pattern and the phone lists. toolbar = the kind of
    // list toolbar on the page (shared ListToolbar, TaskGrid's own, a page-made search box,
    // PowerSearch); tables = visible tables drawn as tables (not cards) and how many of them
    // scroll sideways inside their box ("squeezed").
    const inMain = (sel: string) => (main ? [...main.querySelectorAll(sel)].filter(visible) : []);
    const toolbarKinds = [
      inMain('[data-testid="list-toolbar"]').length ? "ListToolbar" : null,
      inMain('[data-testid$="-toolbar"]:not([data-testid="list-toolbar"]), [role="toolbar"]:not([data-testid="list-toolbar"])').length ? "own toolbar" : null,
      // v1.89.0 (D-423): PowerSearch inside the shared toolbar is that toolbar's filter (Admin -> Records);
      // a search box that finds a page, setting, help topic or field (data-search-kind="finder") is not a list search.
      inMain('[data-testid*="power-search" i]').some((el) => !el.closest('[data-testid="list-toolbar"]')) ? "PowerSearch" : null,
      inMain('input[type="search"], input[name="q"]').some((el) => !el.closest('[data-testid="list-toolbar"], [data-testid*="power-search" i], [role="dialog"], dialog, [data-search-kind]') && !el.hasAttribute("data-search-kind")) ? "page search box" : null,
      inMain('[data-search-kind="finder"]').length ? "finder" : null,
    ].filter(Boolean);
    const tables = inMain("table");
    const asTable = tables.filter((el) => getComputedStyle(el).display === "table");
    // v1.89.0 (D-423): a true matrix (data-matrix) may scroll inside its own box by design; counted apart.
    const matrix = asTable.filter((el) => el.hasAttribute("data-matrix")).length;
    const squeezed = asTable.filter((el) => !el.hasAttribute("data-matrix")).filter((el) => {
      for (let node = el.parentElement; node && node !== main; node = node.parentElement) if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== "visible") return true;
      return false;
    }).length;
    return {
      toolbar: toolbarKinds.join(" + ") || null,
      listPage: inMain("[data-list-page]").length > 0,
      tables: { total: tables.length, asTable: asTable.length, cards: tables.length - asTable.length, squeezed, matrix },
      viewport: { w: vw, h: vh, dpr: window.devicePixelRatio },
      layoutAttr: document.querySelector("[data-layout]")?.getAttribute("data-layout") ?? null,
      view: document.querySelector("[data-view]")?.getAttribute("data-view") ?? null,
      header: header ? { h: px(String(header.getBoundingClientRect().height)), padL: px(getComputedStyle(header).paddingLeft), padR: px(getComputedStyle(header).paddingRight), testid: header.getAttribute("data-testid") } : null,
      sidebar: sidebar && visible(sidebar) ? { w: px(String(sidebar.getBoundingClientRect().width)), collapsed: sidebar.getAttribute("data-collapsed") === "true" } : null,
      mobileMenuButton: Boolean([...document.querySelectorAll("button")].find((b) => /open menu/i.test(b.getAttribute("aria-label") ?? b.textContent ?? "") && visible(b))),
      main: main && mainStyle && mainBox
        ? {
            left: px(String(mainBox.left)),
            top: px(String(mainBox.top + window.scrollY)),
            width: px(String(mainBox.width)),
            padL: px(mainStyle.paddingLeft),
            padR: px(mainStyle.paddingRight),
            padT: px(mainStyle.paddingTop),
            padB: px(mainStyle.paddingBottom),
            maxW: mainStyle.maxWidth,
            contentLeft: px(String(mainBox.left + parseFloat(mainStyle.paddingLeft))),
            contentRight: px(String(vw - mainBox.right + parseFloat(mainStyle.paddingRight))),
          }
        : null,
      firstBlockTop: firstChild ? px(String(firstChild.getBoundingClientRect().top + window.scrollY)) : null,
      headerBottom: header ? px(String(header.getBoundingClientRect().bottom + window.scrollY)) : null,
      pageHeader: (() => {
        const ph = document.querySelector('main [data-tour="page-header"]');
        return ph && visible(ph) ? { mb: px(getComputedStyle(ph).marginBottom), h: px(String(ph.getBoundingClientRect().height)) } : null;
      })(),
      breadcrumb: Boolean([...document.querySelectorAll('nav[aria-label*="readcrumb" i]')].find(visible)),
      h1: h1 && h1Style ? { count: h1s.length, size: px(h1Style.fontSize), weight: h1Style.fontWeight, lh: h1Style.lineHeight, text: (h1.textContent ?? "").trim().slice(0, 60), srOnly: h1.classList.contains("sr-only"), inMain: Boolean(h1.closest("main")) } : { count: 0 },
      h2: hist(h2s),
      body: hist(paras),
      fontSizes,
      buttons: Object.fromEntries(Object.entries(buttons).map(([k, v]) => [k, hist(v)])),
      inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, hist(v)])),
      cardRadius: hist(cards),
      boxRadius: hist(boxes),
      overflowX: docOverflow,
      outsideCount,
      outside,
      formats,
      timing: nav ? { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) } : null,
    };
  });
}

async function layoutShift(page: Page): Promise<number> {
  return page
    .evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) total += entry.value;
            }).observe({ type: "layout-shift", buffered: true });
          } catch {
            resolve(-1);
            return;
          }
          setTimeout(() => resolve(Math.round(total * 10000) / 10000), 120);
        }),
    )
    .catch(() => -1);
}

async function sweep(page: Page, browserName: string, role: RoleKey, vp: Viewport, rail: boolean) {
  const ids = loadIds();
  let routes = routesFor(role, ids);
  if (rail) routes = routes.filter((_, i) => i % 4 === 0).slice(0, 12);
  const records: unknown[] = [];
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  // WebKit only: the service worker can't register across the https shim (webkitHttpsShim); not an app error.
  const shimNoise = browserName.startsWith("webkit") ? [/sw\.js/, /^Not allowed to request resource$/] : [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && ![...IGNORED_CONSOLE, ...shimNoise].some((re) => re.test(msg.text()))) consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (error) => {
    if (!shimNoise.some((re) => re.test(error.message))) consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`);
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "";
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled|Load request cancelled/i.test(reason)) failed.push(`${request.method()} ${new URL(request.url()).pathname} ${reason}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === "localhost" && response.status() >= 400) failed.push(`${response.status()} ${response.request().method()} ${url.pathname}${url.search.slice(0, 60)}`);
  });
  for (const route of routes) {
    consoleErrors.length = 0;
    failed.length = 0;
    const started = Date.now();
    let status = 0;
    let error: string | null = null;
    try {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      status = response?.status() ?? 0;
      await settle(page);
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    const navMs = Date.now() - started;
    const landed = new URL(page.url()).pathname + new URL(page.url()).search;
    let m: Awaited<ReturnType<typeof measure>> | null = null;
    try {
      m = await measure(page);
    } catch (e) {
      error = `${error ?? ""} measure: ${(e as Error).message.slice(0, 120)}`;
    }
    const cls = await layoutShift(page);
    let axe: { id: string; impact: string | null | undefined; nodes: number; help: string; sample: string[] }[] | null = null;
    if (!rail && axeVps.includes(vp.name) && !error) {
      try {
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        axe = result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} :: ${(n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 160)}`) }));
      } catch (e) {
        axe = [{ id: "axe-error", impact: null, nodes: 0, help: (e as Error).message.slice(0, 160), sample: [] }];
      }
    }
    let shot: string | null = null;
    if (shots && !error) {
      shot = path.join(OUT, "shots", browserName, `${vp.name}${rail ? "-rail" : ""}`, `${role}__${slug(route.path)}.jpg`);
      fs.mkdirSync(path.dirname(shot), { recursive: true });
      await page.screenshot({ path: shot, type: "jpeg", quality: 55, animations: "disabled" }).catch(() => (shot = null));
    }
    records.push({ browser: browserName, role, login: ROLES[role].login, vp: vp.name, rail, route: route.pattern, path: route.path, module: moduleOf(route.path), status, landed, navMs, error, cls, console: [...new Set(consoleErrors)].slice(0, 8), failed: [...new Set(failed)].slice(0, 8), axe, shot, ...(m ?? {}) });
  }
  const file = path.join(OUT, "raw", browserName, `${role}__${vp.name}${rail ? "__rail" : ""}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(records, null, 1));
}

for (const role of roleKeys) {
  for (const vpName of vpNames) {
    const vp = VIEWPORTS.find((v) => v.name === vpName)!;
    test(`geometry: ${role} at ${vp.name}`, async ({ browser, browserName }) => {
      test.setTimeout(45 * 60_000);
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch && browserName !== "firefox" });
      await signIn(context, role, vp);
      await webkitHttpsShim(context, test.info().project.name);
      const page = await context.newPage();
      // The project name (chromium, msedge, firefox, webkit), not the engine: Edge's engine is "chromium".
      await sweep(page, `${test.info().project.name}${THEME_SUFFIX}`, role, vp, false);
      await context.close();
    });
    if (process.env.UIQA_RAIL && vp.width >= 1024 && role !== "public") {
      test(`geometry (collapsed sidebar): ${role} at ${vp.name}`, async ({ browser }) => {
        test.setTimeout(20 * 60_000);
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
        await signIn(context, role, vp, [{ name: "ars_sidebar", value: "rail" }]);
        await webkitHttpsShim(context, test.info().project.name);
        const page = await context.newPage();
        await sweep(page, `${test.info().project.name}${THEME_SUFFIX}`, role, vp, true);
        await context.close();
      });
    }
  }
}
