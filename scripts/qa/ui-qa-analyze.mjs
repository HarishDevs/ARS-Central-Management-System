// UI/UX QA audit, phase 1: merges the raw sweep files (audit/ui-qa/raw/<browser>/*.json,
// written by tests/e2e/zz-ui-qa-audit.spec.ts) into audit/ui-qa/geometry.json and
// computes the cross-module inconsistencies at the same viewport into
// audit/ui-qa/summary.json. Read-only on the app; evidence stays local (git-ignored).
// Run: node scripts/qa/ui-qa-analyze.mjs
import fs from "node:fs";
import path from "node:path";

// v1.89.0 stage 4 (D-426): UIQA_OUT, as tests/e2e/ui-qa-shared.ts (one folder per parallel sweep).
const OUT = process.env.UIQA_OUT ?? "audit/ui-qa";
const RAW = path.join(OUT, "raw");
const OWNER = { header: 64, sidebar: 250, rail: 72, padX: 24, padTop: 24, h1: 24, h2: 18, body: 14, button: 40, input: 42, cardRadius: 12, modalRadius: 16 };
// v1.89.0 (D-421): the owner's values are now the app's tokens. The expected shell at a
// viewport (desktop shell; Classic keeps its own box): header 64 (56 below 768), padding
// and top 24 (16 below 768), sidebar 250 from 1280, the 72 rail at 768-1279 (no saved
// choice), none on phones; content left = sidebar + padding; max-width 1600 (left-aligned).
// A difference is listed in summary.conformance (and the overflow list must stay empty).
const PHONE = 768;
const TABLET_MAX = 1279;
function expectedShell(r) {
  const width = Number(String(r.vp).split("x")[0]);
  if (!width || area(r) === "public" || r.view === "classic") return null;
  const phone = width < PHONE;
  const sidebar = phone ? null : r.rail || width <= TABLET_MAX ? OWNER.rail : OWNER.sidebar;
  const pad = phone ? 16 : OWNER.padX;
  return { headerH: phone ? 56 : OWNER.header, padL: pad, padT: phone ? 16 : OWNER.padTop, sidebarW: sidebar, contentLeft: (sidebar ?? 0) + pad, maxW: phone || r.layoutAttr === "mobile" ? null : "1600px" };
}

const records = [];
for (const browser of fs.existsSync(RAW) ? fs.readdirSync(RAW) : []) {
  for (const file of fs.readdirSync(path.join(RAW, browser))) {
    if (file.endsWith(".json")) records.push(...JSON.parse(fs.readFileSync(path.join(RAW, browser, file), "utf8")));
  }
}
fs.writeFileSync(path.join(OUT, "geometry.json"), JSON.stringify(records, null, 1));

const area = (r) => (r.path.startsWith("/superadmin") ? "superadmin" : r.path.startsWith("/admin") ? "admin" : r.path.startsWith("/users") ? "users" : "public");
const ok = (r) => !r.error && r.status && r.status < 400 && r.main;
const groupBy = (list, key) => list.reduce((acc, item) => ((acc[key(item)] ??= []).push(item), acc), {});
const distinct = (list, value) => {
  const out = {};
  for (const r of list) {
    const v = value(r);
    if (v === undefined) continue;
    (out[String(v)] ??= []).push(r.path);
  }
  return out;
};
const merge = (hists) => hists.reduce((acc, h) => {
  for (const [k, n] of Object.entries(h ?? {})) acc[k] = (acc[k] ?? 0) + n;
  return acc;
}, {});
const top = (h, n = 8) => Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, n));

const summary = { generated: new Date().toISOString(), owner: OWNER, conformance: [], counts: {}, shell: {}, h1: {}, controls: {}, radius: {}, overflow: [], outside: [], errors: [], failed: [], axe: {}, cls: [], slow: [], formats: {}, status: [] };
const byBrowser = groupBy(records, (r) => r.browser);
for (const [browser, list] of Object.entries(byBrowser)) {
  summary.counts[browser] = { visits: list.length, ok: list.filter(ok).length, routes: new Set(list.map((r) => `${r.role} ${r.route}`)).size, viewports: [...new Set(list.map((r) => r.vp))] };
}

// Shell geometry per browser, viewport and area: every distinct value with the pages that have it.
for (const r of records) if (r.status >= 400 || r.error) summary.status.push({ browser: r.browser, vp: r.vp, role: r.role, path: r.path, status: r.status, landed: r.landed, error: r.error });
const desk = records.filter((r) => ok(r) && !r.rail);
for (const [key, list] of Object.entries(groupBy(desk, (r) => `${r.browser} | ${r.vp} | ${area(r)}`))) {
  summary.shell[key] = {
    headerH: distinct(list, (r) => r.header?.h),
    headerPadL: distinct(list, (r) => r.header?.padL),
    sidebarW: distinct(list, (r) => r.sidebar?.w ?? "none"),
    mainPadL: distinct(list, (r) => r.main.padL),
    mainPadT: distinct(list, (r) => r.main.padT),
    mainMaxW: distinct(list, (r) => r.main.maxW),
    contentLeft: distinct(list, (r) => r.main.contentLeft),
    contentRight: distinct(list, (r) => r.main.contentRight),
    gapHeaderToFirstBlock: distinct(list, (r) => (r.firstBlockTop != null && r.headerBottom != null ? Math.round(r.firstBlockTop - r.headerBottom) : "n/a")),
    pageHeaderMb: distinct(list, (r) => r.pageHeader?.mb ?? "no PageHeader"),
    breadcrumb: distinct(list, (r) => r.breadcrumb),
    layout: distinct(list, (r) => r.layoutAttr ?? "desktop"),
  };
}
for (const [key, list] of Object.entries(groupBy(records.filter((r) => ok(r) && r.rail), (r) => `${r.browser} | ${r.vp} | ${area(r)} | rail`))) {
  summary.shell[key] = { sidebarW: distinct(list, (r) => r.sidebar?.w ?? "none"), contentLeft: distinct(list, (r) => r.main.contentLeft) };
}

// h1 per module at each viewport.
for (const [key, list] of Object.entries(groupBy(desk.filter((r) => r.browser === "chromium"), (r) => `${r.vp} | ${r.module}`))) {
  summary.h1[key] = { size: distinct(list, (r) => (r.h1?.count ? `${r.h1.size}px/${r.h1.weight}${r.h1.srOnly ? " (sr-only)" : ""}` : "no h1")), count: distinct(list, (r) => r.h1?.count ?? 0) };
}

// Controls and radius, merged per viewport and area (Chromium).
for (const [key, list] of Object.entries(groupBy(desk.filter((r) => r.browser === "chromium"), (r) => `${r.vp} | ${area(r)}`))) {
  const kinds = new Set(list.flatMap((r) => Object.keys(r.buttons ?? {})));
  const ikinds = new Set(list.flatMap((r) => Object.keys(r.inputs ?? {})));
  summary.controls[key] = {
    buttons: Object.fromEntries([...kinds].map((k) => [k, top(merge(list.map((r) => r.buttons?.[k])))])),
    inputs: Object.fromEntries([...ikinds].map((k) => [k, top(merge(list.map((r) => r.inputs?.[k])))])),
    h2: top(merge(list.map((r) => r.h2))),
    body: top(merge(list.map((r) => r.body))),
    fontSizes: top(merge(list.map((r) => r.fontSizes)), 12),
  };
  summary.radius[key] = { card: top(merge(list.map((r) => r.cardRadius))), box: top(merge(list.map((r) => r.boxRadius))) };
}

for (const r of records.filter(ok)) {
  const want = expectedShell(r);
  if (want) {
    const got = { headerH: r.header?.h ?? null, padL: r.main.padL, padT: r.main.padT, sidebarW: r.sidebar?.w ?? null, contentLeft: r.main.contentLeft, maxW: want.maxW === null ? null : r.main.maxW };
    const off = Object.keys(want).filter((key) => (typeof want[key] === "number" ? Math.abs((got[key] ?? -999) - want[key]) > 1 : got[key] !== want[key]));
    if (off.length) summary.conformance.push({ browser: r.browser, vp: r.vp, role: r.role, rail: r.rail, path: r.path, off: Object.fromEntries(off.map((key) => [key, { want: want[key], got: got[key] }])) });
  }
  if (r.overflowX > 1) summary.overflow.push({ browser: r.browser, vp: r.vp, role: r.role, path: r.path, overflowX: r.overflowX, outside: r.outside?.slice(0, 3) });
  else if (r.outsideCount > 0) summary.outside.push({ browser: r.browser, vp: r.vp, role: r.role, path: r.path, count: r.outsideCount, outside: r.outside?.slice(0, 3) });
  if (r.console?.length) summary.errors.push({ browser: r.browser, vp: r.vp, role: r.role, path: r.path, console: r.console });
  if (r.failed?.length) summary.failed.push({ browser: r.browser, vp: r.vp, role: r.role, path: r.path, failed: r.failed });
  if (r.cls > 0.05) summary.cls.push({ browser: r.browser, vp: r.vp, role: r.role, path: r.path, cls: r.cls });
  if (r.navMs > 4000) summary.slow.push({ browser: r.browser, vp: r.vp, role: r.role, path: r.path, navMs: r.navMs });
  for (const v of r.axe ?? []) {
    const k = `${r.browser} | ${v.id}`;
    const entry = (summary.axe[k] ??= { id: v.id, browser: r.browser, impact: v.impact, help: v.help, pages: 0, nodes: 0, where: [] });
    entry.pages += 1;
    entry.nodes += v.nodes;
    if (entry.where.length < 40) entry.where.push(`${r.vp} ${r.role} ${r.path} (${v.nodes}) ${v.sample?.[0] ?? ""}`.slice(0, 300));
  }
}
for (const [mod, list] of Object.entries(groupBy(desk.filter((r) => r.browser === "chromium" && r.vp === "1440x900"), (r) => r.module))) {
  summary.formats[mod] = merge(list.map((r) => r.formats));
  for (const k of Object.keys(summary.formats[mod])) if (!summary.formats[mod][k]) delete summary.formats[mod][k];
}
// v1.89.0 (D-422): list toolbar patterns (Chromium, 1440) and phone tables drawn as squeezed tables.
summary.toolbars = distinct(desk.filter((r) => r.browser === "chromium" && r.vp === "1440x900" && r.toolbar), (r) => r.toolbar);
summary.phoneTables = records.filter((r) => ok(r) && r.browser === "chromium" && /^(360|390|430)x/.test(r.vp) && r.tables?.squeezed > 0).map((r) => `${r.vp} ${r.role} ${r.path} (${r.tables.squeezed} of ${r.tables.total})`);
// v1.89.0 (D-423): pages with the shared toolbar that sit in ListPage, and the ones that don't (1440, Chromium).
const at1440 = desk.filter((r) => r.browser === "chromium" && r.vp === "1440x900" && /ListToolbar/.test(r.toolbar ?? ""));
summary.listPages = { inListPage: [...new Set(at1440.filter((r) => r.listPage).map((r) => r.path))], toolbarOnly: [...new Set(at1440.filter((r) => !r.listPage).map((r) => r.path))] };
summary.phoneMatrix = records.filter((r) => ok(r) && r.browser === "chromium" && /^(360|390|430)x/.test(r.vp) && r.tables?.matrix > 0).map((r) => `${r.vp} ${r.role} ${r.path} (${r.tables.matrix})`);
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ counts: summary.counts, conformance: summary.conformance.length, overflow: summary.overflow.length, outside: summary.outside.length, errors: summary.errors.length, failed: summary.failed.length, axeRules: Object.keys(summary.axe).length, cls: summary.cls.length, slow: summary.slow.length, status: summary.status.length, toolbarPatterns: Object.keys(summary.toolbars).length, phoneSqueezedTables: summary.phoneTables.length, phoneMatrix: summary.phoneMatrix.length, inListPage: summary.listPages.inListPage.length, toolbarOnly: summary.listPages.toolbarOnly.length }, null, 1));
