import { expect, test, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.80.0 (D-407, motion review point 15): no content jumps. Cumulative
// Layout Shift (PerformanceObserver "layout-shift", shifts after input left
// out) on Home and Waiting for me, desktop and phone widths. The numbers are
// written to test-results/cls.json and recorded in DEVELOPMENT-MEMORY; the
// test fails above 0.1 (the "good" threshold).
async function cls(page: Page, path: string): Promise<number> {
  await page.addInitScript(() => {
    const store = window as unknown as { __cls: number };
    store.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) store.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

test("CLS on Home and Waiting for me stays under 0.1", async ({ browser }, info) => {
  const results: Record<string, number> = {};
  for (const [label, size] of [
    ["desktop", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    for (const path of ["/users", "/users/queue"]) {
      const context = await browser.newContext({ viewport: size });
      await context.addCookies([await sessionCookie("E2E_MGR")]);
      const page = await context.newPage();
      // Twice: the first visit also warms the server; the second is the measure.
      await cls(page, path);
      const second = await context.newPage();
      results[`${label} ${path}`] = Number((await cls(second, path)).toFixed(4));
      await context.close();
    }
  }
  await info.attach("cls.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  console.log(`CLS ${JSON.stringify(results)}`);
  for (const value of Object.values(results)) expect(value).toBeLessThan(0.1);
});
