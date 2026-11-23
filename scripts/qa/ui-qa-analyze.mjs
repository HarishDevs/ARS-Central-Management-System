// UI/UX QA audit, phase 1: merges the raw sweep files (audit/ui-qa/raw/<browser>/*.json,
// written by tests/e2e/zz-ui-qa-audit.spec.ts) into audit/ui-qa/geometry.json and
// computes the cross-module inconsistencies at the same viewport into
// audit/ui-qa/summary.json. Read-only on the app; evidence stays local (git-ignored).
// Run: node scripts/qa/ui-qa-analyze.mjs
import fs from "node:fs";
import path from "node:path";

const OUT = "audit/ui-qa";
const RAW = path.join(OUT, "raw");
const OWNER = { header: 64, sidebar: 250, rail: 72, padX: 24, padTop: 24, h1: 24, h2: 18, body: 14, button: 40, input: 42, cardRadius: 12, modalRadius: 16 };

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

const summary = { generated: new Date().toISOString(), owner: OWNER, counts: {}, shell: {}, h1: {}, controls: {}, radius: {}, overflow: [], outside: [], errors: [], failed: [], axe: {}, cls: [], slow: [], formats: {}, status: [] };
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
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ counts: summary.counts, overflow: summary.overflow.length, outside: summary.outside.length, errors: summary.errors.length, failed: summary.failed.length, axeRules: Object.keys(summary.axe).length, cls: summary.cls.length, slow: summary.slow.length, status: summary.status.length }, null, 1));
