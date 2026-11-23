import { expect, test, type Page } from "@playwright/test";
import { sessionCookie } from "./db";

// v1.59.2 (D-361, owner): every table's columns resize by dragging a title's
// right edge (kept after a reload; double-click resets); long text in a cell
// shows two lines, then …. Nothing is added inside the table (hydration-safe).
const header = (page: Page) => page.locator("main table thead th").nth(1);

async function dragEdge(page: Page, by: number) {
  const box = (await header(page).boundingBox())!;
  const x = box.x + box.width - 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by / 2, y, { steps: 4 });
  await page.mouse.move(x + by, y, { steps: 4 });
  await page.mouse.up();
}

test("a column widens by dragging its edge, stays after a reload, and double-click resets it", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_SUPER", { tourDone: true })]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/superadmin/monitoring/audit");
  await expect(header(page)).toBeVisible();
  const url = page.url();
  const before = (await header(page).boundingBox())!.width;
  await dragEdge(page, 140);
  await expect.poll(async () => (await header(page).boundingBox())!.width).toBeGreaterThan(before + 100);
  expect(page.url()).toBe(url); // the drag didn't sort
  const widened = (await header(page).boundingBox())!.width;
  // No element was added inside the table.
  await expect(page.locator("main table thead th").nth(1).locator("span[aria-hidden], [data-col-resize]")).toHaveCount(0);

  await page.reload();
  await expect.poll(async () => Math.round((await header(page).boundingBox())!.width)).toBe(Math.round(widened));

  const box = (await header(page).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width - 2, box.y + box.height / 2);
  await expect.poll(async () => (await header(page).boundingBox())!.width).toBeLessThan(widened - 60);
});

test("long text in a table cell stops at two lines", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_SUPER", { tourDone: true })]);
  await page.goto("/superadmin/monitoring/audit");
  const result = await page.evaluate(() => {
    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = '<tbody><tr><td style="width:120px"><span class="cell-text">' + "A long reason that goes on and on ".repeat(12) + "</span></td></tr></tbody>";
    document.getElementById("main")!.appendChild(table);
    const span = table.querySelector("span")!;
    const lineHeight = Number.parseFloat(getComputedStyle(span).lineHeight);
    return { clamp: getComputedStyle(span).webkitLineClamp, lines: Math.round(span.getBoundingClientRect().height / lineHeight) };
  });
  expect(result.clamp).toBe("2");
  expect(result.lines).toBeLessThanOrEqual(2);
});

test("task lists: a column's edge resizes from the keyboard and the width is kept", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_REQ", { tourDone: true })]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/users/work/my-tasks");
  const handle = page.getByTestId("col-resize").first();
  test.skip((await handle.count()) === 0, "no task list on this page in this run");
  const column = await handle.getAttribute("data-column");
  const cell = page.locator(`[role="columnheader"][data-column="${column}"]`).first();
  const before = (await cell.boundingBox())!.width;
  await handle.focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await cell.boundingBox())!.width).toBeGreaterThan(before + 30);
  await page.reload();
  await expect.poll(async () => (await page.locator(`[role="columnheader"][data-column="${column}"]`).first().boundingBox())!.width).toBeGreaterThan(before + 30);
  await page.getByTestId("col-resize").first().press("Enter");
  await expect.poll(async () => (await page.locator(`[role="columnheader"][data-column="${column}"]`).first().boundingBox())!.width).toBeLessThan(before + 10);
});
