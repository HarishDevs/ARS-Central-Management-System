import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { createWorkflow, publishVersion, submitRequest, withdrawRequest, type Actor } from "@/server/approvals/service";
import { setAccessRule } from "@/lib/db/repositories/page-access.repository";
import { checkPageKey } from "@/server/authorization/page-access";
import { PAGES } from "@/server/authorization/pages";
import { createUser } from "./helpers";

// v1.10.0 security hardening on real MySQL: page rules bound to the action
// (G-3), the start-up seed no longer re-grants Super Admin (AUD-03), and
// request lifecycle changes reach the central audit log (SEC-12).
let it1: number;
let admin: Actor;
let workflowId: number;

beforeAll(async () => {
  it1 = await createUser({ name: "V110 IT", roles: ["USER", "IT_ADMIN"] });
  const adminId = await createUser({ name: "V110 Admin", roles: ["USER", "IT_ADMIN"] });
  admin = { id: adminId, roles: ["USER", "IT_ADMIN"] };
  const approver = await createUser({ name: "V110 Approver" });
  const created = await createWorkflow(
    {
      code: `V110_${Date.now()}`,
      name: "V110 type",
      kind: "PREDEFINED",
      requestPrefix: "VX",
      form: [{ key: "amount", label: "Amount", type: "NUMBER", required: true }],
      definition: {
        nodes: [
          { id: "start", kind: "START", label: "Start" },
          { id: "a", kind: "APPROVAL", label: "V110 Step", approvers: [{ type: "USER", userId: approver }], completion: { type: "ALL" } },
          { id: "end", kind: "END", label: "End" },
        ],
        edges: [
          { id: "e1", from: "start", to: "a" },
          { id: "e2", from: "a", to: "end" },
        ],
      },
    },
    admin,
  );
  if (!created.ok) throw new Error(created.message);
  await publishVersion(created.value.versionId, admin);
  workflowId = created.value.workflowId;
});

// v1.89.0 stage 4 (D-426): the rule is on a page that exists. The test used "admin.import",
// which v1.84.0 (D-411) removed (Import data became Super Admin only, and Super Admin pages
// carry no page rules): an unknown key always reads FULL, so the test failed since then.
// "admin.users" is an Admin page whose shared actions name it (app/users/collab-actions.ts).
const PAGE_KEY = "admin.users";

afterAll(async () => {
  await setAccessRule({ pageKey: PAGE_KEY, scope: "USER", scopeId: it1, level: null, actorId: admin.id });
});

describe("G-3: an action's own page rule applies wherever it is posted from", () => {
  it("Hidden refuses; View-only allows reading but not changing; Super Admin is exempt", async () => {
    expect(PAGES.some((page) => page.key === PAGE_KEY && !page.neverHidden)).toBe(true);
    const person = { id: it1, roles: ["USER", "IT_ADMIN"], modules: ["APPROVAL", "TASK", "INFORMATION"] as const };
    expect(await checkPageKey(person, PAGE_KEY, true)).toEqual({ ok: true, level: "FULL" });
    await setAccessRule({ pageKey: PAGE_KEY, scope: "USER", scopeId: it1, level: "HIDDEN", actorId: admin.id });
    expect(await checkPageKey(person, PAGE_KEY, false)).toMatchObject({ ok: false, reason: "HIDDEN", pageKey: PAGE_KEY });
    await setAccessRule({ pageKey: PAGE_KEY, scope: "USER", scopeId: it1, level: "VIEW", actorId: admin.id });
    expect(await checkPageKey(person, PAGE_KEY, false)).toMatchObject({ ok: true, level: "VIEW" });
    expect(await checkPageKey(person, PAGE_KEY, true)).toMatchObject({ ok: false, reason: "VIEW_ONLY" });
    expect(await checkPageKey({ id: it1, roles: ["USER", "SUPER_ADMIN"], modules: [] }, PAGE_KEY, true)).toEqual({ ok: true, level: null });
  });
});

describe("AUD-03: the start-up seed gives itadmin roles only when it has none", () => {
  const seed = () =>
    execFileSync(process.execPath, [path.resolve(__dirname, "../../scripts/database/seed.js")], {
      env: { ...process.env },
      stdio: "pipe",
    });
  const rolesOf = async (userId: number) => {
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.code", [userId]);
    return rows.map((row) => String(row.code));
  };

  it("a removed Super Admin role stays removed after a restart; a fresh account still gets its roles", async () => {
    const [[row]] = await getDbPool().query<RowDataPacket[]>("SELECT id FROM users WHERE login_id = 'itadmin'");
    const itadmin = Number(row!.id);
    const before = await rolesOf(itadmin);
    try {
      await getDbPool().query("DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.code = 'SUPER_ADMIN'", [itadmin]);
      seed();
      expect(await rolesOf(itadmin)).not.toContain("SUPER_ADMIN");
      // No roles at all (first start): all three are given.
      await getDbPool().query("DELETE FROM user_roles WHERE user_id = ?", [itadmin]);
      seed();
      expect(await rolesOf(itadmin)).toEqual(["IT_ADMIN", "SUPER_ADMIN", "USER"]);
    } finally {
      await getDbPool().query("DELETE FROM user_roles WHERE user_id = ?", [itadmin]);
      for (const code of before) await getDbPool().query("INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = ?", [itadmin, code]);
    }
  });
});

describe("SEC-12: request lifecycle changes are in the central audit log", () => {
  it("submit and withdraw are audited with the actor", async () => {
    const requester = await createUser({ name: "V110 Requester" });
    const actor: Actor = { id: requester, roles: ["USER"] };
    const submitted = await submitRequest({ workflowId, title: "V110 audit", fields: { amount: "5" } }, actor);
    if (!submitted.ok) throw new Error(submitted.message);
    const withdrawn = await withdrawRequest({ requestId: submitted.value.requestId, reason: "Not needed" }, actor);
    expect(withdrawn.ok).toBe(true);
    const [rows] = await getDbPool().query<RowDataPacket[]>("SELECT action, actor_user_id FROM audit_logs WHERE entity_type = 'REQUEST' AND entity_id = ? ORDER BY id", [String(submitted.value.requestId)]);
    expect(rows.map((item) => item.action)).toEqual(expect.arrayContaining(["REQUEST_SUBMITTED", "REQUEST_WITHDRAWN"]));
    expect(rows.every((item) => Number(item.actor_user_id) === requester)).toBe(true);
  });
});
