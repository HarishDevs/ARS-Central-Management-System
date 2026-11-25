import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db, sessionCookie, userIdByLogin } from "./db";

// v1.87.0 (D-417, header and motion audit: performance): 50 open/close
// cycles of the task pane (a user on My Tasks) and of the record pane (IT on
// Admin → Records), measured the v1800-cls way (PerformanceObserver from the
// first paint): layout shift, long tasks, DOM nodes, JS heap (after a forced
// garbage collection), open overlays left behind and history entries added.
// The numbers go to test-results/motion-perf-<label>.json (MOTION_PERF_LABEL,
// default "after") and are recorded in GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md.
test.describe.configure({ mode: "serial" });

const CYCLES = Number(process.env.MOTION_PERF_CYCLES ?? 50);
const LABEL = process.env.MOTION_PERF_LABEL ?? "after";
const stamp = Date.now().toString(36);
let staffTask = 0;
const results: Record<string, unknown> = {};

const PERF_INIT = () => {
  const w = window as unknown as { __perf: { cls: number; longTasks: number; longest: number } };
  w.__perf = { cls: 0, longTasks: 0, longest: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!entry.hadRecentInput) w.__perf.cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__perf.longTasks += 1;
        w.__perf.longest = Math.max(w.__perf.longest, entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    /* not supported */
  }
};

async function sample(page: Page) {
  // v1.89.0 stage 4 (D-426): the heap is read over CDP, which only Chromium has. In Firefox and
  // WebKit the heap reads 0 (its check passes trivially); every other check runs in every browser.
  let heap = { usedSize: 0 };
  if (page.context().browser()?.browserType().name() === "chromium") {
    const client = await page.context().newCDPSession(page);
    await client.send("HeapProfiler.collectGarbage");
    heap = (await client.send("Runtime.getHeapUsage")) as { usedSize: number };
    await client.detach();
  }
  return page.evaluate((used) => {
    const perf = (window as unknown as { __perf: { cls: number; longTasks: number; longest: number } }).__perf;
    return {
      nodes: document.getElementsByTagName("*").length,
      heapMB: Math.round((used / 1048576) * 10) / 10,
      overlays: document.querySelectorAll("[data-task-pane], [data-record-pane], dialog[open], [data-testid=m-sheet]").length,
      inert: document.querySelectorAll("[inert]").length,
      scrollLocked: document.documentElement.style.overflow === "hidden",
      history: history.length,
      cls: Math.round(perf.cls * 10000) / 10000,
      longTasks: perf.longTasks,
      longestMs: Math.round(perf.longest),
    };
  }, heap.usedSize);
}

test.beforeAll(async () => {
  const conn = await db();
  try {
    const [[version]] = await conn.query<RowDataPacket[]>("SELECT v.id FROM module_type_versions v JOIN module_types m ON m.id = v.type_id WHERE m.module = 'TASK' AND v.status = 'PUBLISHED' ORDER BY v.id LIMIT 1");
    const from = await userIdByLogin("E2E_REQ");
    const me = await userIdByLogin("E2E_STAFF");
    for (let i = 0; i < 12; i++) {
      const [made] = await conn.query<ResultSetHeader>(
        "INSERT INTO tasks (task_no, type_version_id, title, priority, status, created_by, assignee_id, assigned_by, assigned_at, due_at, form_data_json) VALUES (?, ?, ?, 'NORMAL', 'OPEN', ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), JSON_OBJECT())",
        [`MP${i}${stamp}`.slice(0, 30), Number(version!.id), `Motion perf ${stamp} ${i}`, from, me, from, i % 4],
      );
      if (i === 0) staffTask = made.insertId;
    }
  } finally {
    await conn.end();
  }
});

test.afterAll(() => {
  const out = path.join(process.cwd(), "test-results", `motion-perf-${LABEL}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ label: LABEL, cycles: CYCLES, ...results }, null, 2));
  console.log(`MOTION-PERF ${LABEL} ${JSON.stringify(results)}`);
});

test(`task pane: ${CYCLES} open/close cycles on My Tasks (CLS, long tasks, memory, leftovers)`, async ({ page, context }) => {
  test.setTimeout(8 * 60_000);
  await page.addInitScript(PERF_INIT);
  await context.addCookies([await sessionCookie("E2E_STAFF", { tourDone: true })]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  await page.waitForLoadState("networkidle");
  const link = page.locator(`main a[href="/users/tasks/${staffTask}"]`).first();
  await link.scrollIntoViewIfNeeded();
  // One warm-up cycle, then the measure.
  await link.click();
  await page.getByTestId("task-pane").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("task-pane").waitFor({ state: "detached" });
  const first = await sample(page);
  const started = Date.now();
  for (let i = 0; i < CYCLES; i++) {
    await link.click();
    await page.getByTestId("task-pane").waitFor();
    await page.keyboard.press("Escape");
    await page.getByTestId("task-pane").waitFor({ state: "detached" });
  }
  const cycleMs = Math.round((Date.now() - started) / CYCLES);
  await page.waitForTimeout(500);
  const last = await sample(page);
  results.taskPane = { first, last, cycleMs };
  expect(last.overlays, "no pane or dialog left open").toBe(0);
  expect(last.inert, "nothing left inert").toBe(0);
  expect(last.scrollLocked, "scroll not left locked").toBe(false);
  expect(last.nodes - first.nodes, "DOM nodes don't grow").toBeLessThanOrEqual(Math.ceil(first.nodes * 0.05));
  expect(last.heapMB - first.heapMB, "heap doesn't grow (MB)").toBeLessThan(8);
  expect(last.cls, "CLS stays under 0.1").toBeLessThan(0.1);
});

test(`record pane: ${CYCLES} open/close cycles on Admin → Records`, async ({ page, context }) => {
  test.setTimeout(8 * 60_000);
  await page.addInitScript(PERF_INIT);
  await context.addCookies([await sessionCookie("E2E_ADMIN", { tourDone: true })]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/records/tasks");
  await page.waitForLoadState("networkidle");
  const open = page.getByTestId("record-open").first();
  test.skip((await open.count()) === 0, "no records to open");
  await open.click();
  await page.getByTestId("record-pane").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("record-pane").waitFor({ state: "detached" });
  const first = await sample(page);
  const started = Date.now();
  for (let i = 0; i < CYCLES; i++) {
    await open.click();
    await page.getByTestId("record-pane").waitFor();
    await page.keyboard.press("Escape");
    await page.getByTestId("record-pane").waitFor({ state: "detached" });
  }
  const cycleMs = Math.round((Date.now() - started) / CYCLES);
  await page.waitForTimeout(500);
  const last = await sample(page);
  results.recordPane = { first, last, cycleMs };
  expect(last.overlays).toBe(0);
  expect(last.inert).toBe(0);
  expect(last.nodes - first.nodes).toBeLessThanOrEqual(Math.ceil(first.nodes * 0.05));
  expect(last.heapMB - first.heapMB).toBeLessThan(8);
  expect(last.cls).toBeLessThan(0.1);
});
