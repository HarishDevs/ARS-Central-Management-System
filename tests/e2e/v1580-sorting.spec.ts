import { expect, test } from "@playwright/test";
import { sessionCookie } from "./db";
import { LIST_SORT_COLUMNS } from "@/server/requests/list-filters";
import { QUEUE_SORT_COLUMNS } from "@/server/approvals/queue-filters";
import { TASK_COLUMNS } from "@/server/modules/task-lists";
import { INBOX_SORT_COLUMNS, SENT_SORT_COLUMNS } from "@/server/modules/info-lists";
import { MEETING_SORT_COLUMNS } from "@/server/meetings/list-sort";
// (tickets.repository is server-only; its column list is repeated here)
const TICKET_SORT_COLUMNS = ["ticket", "subject", "requestor", "department", "priority", "assignee", "created", "target", "status", "task"] as const;
import { USER_SORT_COLUMNS } from "@/server/admin/lists";
import { AUDIT_COLUMNS, LOGIN_COLUMNS, REQUEST_COLUMNS } from "@/server/lists/superadmin-lists";
import { SORTS } from "@/server/records/filters";

// v1.58.0 (D-351, owner: "sorting in all the tables asc to desc or vice versa in
// all columns"): every server-sorted list opens with every column, both ways,
// against the real database (the new ORDER BY of each column really runs).
const broken = /This page couldn.t be shown|Something went wrong/;

async function opens(page: import("@playwright/test").Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBeLessThan(400);
  await expect(page.locator("main"), url).not.toContainText(broken);
}

test("every column of every server-sorted list sorts both ways", async ({ page, context }) => {
  test.setTimeout(600_000);
  await context.addCookies([await sessionCookie("E2E_SUPER")]);
  const lists: [string, readonly string[], string, string][] = [
    ["/users/requests", LIST_SORT_COLUMNS.filter((column) => column !== "raiser" && column !== "added"), "sortBy", "dir"],
    ["/users/collaborating", LIST_SORT_COLUMNS, "sortBy", "dir"],
    ["/users/approved", LIST_SORT_COLUMNS.filter((column) => column !== "raiser" && column !== "added"), "sortBy", "dir"],
    ["/users/approved-by-me", LIST_SORT_COLUMNS.filter((column) => column !== "added"), "sortBy", "dir"],
    ["/users/queue", QUEUE_SORT_COLUMNS, "sortBy", "dir"],
    ["/users/tasks", TASK_COLUMNS.filter((column) => column !== "repeats" && column !== "done"), "sortBy", "dir"],
    ["/users/tasks/assigned", TASK_COLUMNS.filter((column) => column !== "repeats" && column !== "done"), "sortBy", "dir"],
    ["/users/work/periodic", TASK_COLUMNS, "sortBy", "dir"],
    ["/users/information", INBOX_SORT_COLUMNS, "sortBy", "dir"],
    ["/users/information/sent", SENT_SORT_COLUMNS, "sortBy", "dir"],
    ["/users/meetings?tab=all", MEETING_SORT_COLUMNS, "sortBy", "dir"],
    ["/users/tickets?state=all", TICKET_SORT_COLUMNS.filter((column) => column !== "task"), "sortBy", "dir"],
    ["/users/tickets?state=all&view=assigned", TICKET_SORT_COLUMNS, "sortBy", "dir"],
    ["/admin/users", USER_SORT_COLUMNS, "sortBy", "dir"],
    ["/admin/records/requests", Object.keys(SORTS.requests), "sort", "dir"],
    ["/admin/records/tasks", Object.keys(SORTS.tasks), "sort", "dir"],
    ["/admin/records/information", Object.keys(SORTS.information), "sort", "dir"],
    ["/superadmin/audit", AUDIT_COLUMNS, "sortBy", "dir"],
    ["/superadmin/logins", LOGIN_COLUMNS, "sortBy", "dir"],
    ["/superadmin/requests", REQUEST_COLUMNS, "sortBy", "dir"],
  ];
  // v1.58.1 (owner: a request's Priority sorts in every table): the Home tables.
  for (const prefix of ["hq", "ha"]) lists.push(["/users?home=approvals", ["title", "priority", "from", "step", "since", "due"].map((column) => `${prefix}.${column}`), "sortBy", "dir"]);
  for (const prefix of ["hx", "hr"]) lists.push(["/users?home=approvals", ["title", "type", "status", "priority", "waiting", "raised"].map((column) => `${prefix}.${column}`), "sortBy", "dir"]);
  for (const [path, columns, sortKey, dirKey] of lists) {
    for (const column of columns) {
      for (const dir of ["asc", "desc"]) {
        await opens(page, `${path}${path.includes("?") ? "&" : "?"}${sortKey}=${column}&${dirKey}=${dir}`);
      }
    }
  }
});

const priorityHead = (page: import("@playwright/test").Page) => page.locator("th").filter({ has: page.getByTestId("sort-link").filter({ hasText: /^Priority$/ }) }).first();

test("a request's Priority is a sort link on the records register, Super Admin requests and Home", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_SUPER")]);
  for (const url of ["/admin/records/requests", "/superadmin/requests"]) {
    await page.goto(url);
    // The tables show their columns only once there is a request (earlier specs raise them).
    test.skip((await page.locator("main table").count()) === 0, "no requests in this run");
    await expect(priorityHead(page), url).toBeVisible();
  }
  await page.goto("/admin/records/requests?sort=priority&dir=asc");
  await expect(priorityHead(page)).toHaveAttribute("aria-sort", "ascending");
  await page.goto("/superadmin/requests?sortBy=priority&dir=desc");
  await expect(priorityHead(page)).toHaveAttribute("aria-sort", "descending");
});

test("a grouped list starts folded; Expand all and Collapse all work; a view saves and opens", async ({ page, context }) => {
  await context.addCookies([await sessionCookie("E2E_SUPER")]);
  await page.goto("/admin/users?group=status");
  const fold = page.getByTestId("group-fold").first();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Expand all" }).first().click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Collapse all" }).first().click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");

  // Save the grouped, sorted list as a named view and open it again.
  const name = `Grouped ${Date.now().toString(36)}`;
  await page.goto("/admin/users?group=status&sortBy=name&dir=desc");
  await page.getByTestId("save-view").first().click();
  await page.getByPlaceholder(/e\.g\./).first().fill(name);
  await page.getByRole("button", { name: "Save view" }).first().click();
  await expect(page.getByText(`Saved "${name}".`)).toBeVisible();
  await page.goto("/admin/users");
  await page.getByTestId("saved-views").getByRole("link", { name }).click();
  await expect(page).toHaveURL(/group=status/);
  await expect(page).toHaveURL(/sortBy=name/);
  await expect(page).toHaveURL(/dir=desc/);
});
