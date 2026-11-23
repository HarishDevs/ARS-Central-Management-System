import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isUnknownUsersPath } from "@/lib/routing/unknown-users-path";

// v1.85.1 (D-413): the middleware's list of /users page addresses must match
// the app/users folders, or a new page would answer 404 (or an unknown address 200).
const ROOT = path.resolve(__dirname, "../..");

describe("users route list (D-413)", () => {
  it("the committed list is what the generator writes from app/users", async () => {
    // @ts-expect-error: a plain .mjs build script without type declarations.
    const { usersRoutesSource } = await import("../../scripts/dev/write-users-routes.mjs");
    const committed = fs.readFileSync(path.join(ROOT, "lib/routing/users-routes.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(committed, "run: node scripts/dev/write-users-routes.mjs").toBe(usersRoutesSource());
  });

  it("knows the real /users pages, dynamic ones included", () => {
    for (const known of ["/users", "/users/", "/users/queue", "/users/tasks", "/users/tasks/42", "/users/requests/7", "/users/profile", "/users/new", "/users/work/projects/3/automations/9", "/users/menu/TASK", "/users/no-access"]) {
      expect(isUnknownUsersPath(known), known).toBe(false);
    }
  });

  it("calls any other /users address unknown, and leaves other areas alone", () => {
    for (const unknown of ["/users/this-page-does-not-exist", "/users/tasks/42/extra", "/users/@pane", "/users/(home)", "/users/queue/x/y"]) {
      expect(isUnknownUsersPath(unknown), unknown).toBe(true);
    }
    for (const other of ["/admin/nothing", "/superadmin/x", "/api/users/x", "/userss", "/login", "/"]) {
      expect(isUnknownUsersPath(other), other).toBe(false);
    }
  });
});
