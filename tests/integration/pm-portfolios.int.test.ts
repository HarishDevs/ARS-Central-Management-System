import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as portfolios from "@/server/work/portfolios";
import { runWorkPurge } from "@/server/work/purge";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser, workingDayFrom } from "./helpers";

// v1.69.0 (D-382, PM phase D part 3) through the services: create (with
// projects and people), who may do what, masking of projects a person can't
// see (and roll-ups that leave them out), nesting rules (no circles, 5
// levels), columns and values, status updates, the dashboard, the off-track
// notice, the switch, and the 30-day purge (portfolios, and a purged project
// leaving every portfolio).
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `P${id}`, modules: ModuleCode[] = ALL) => ({ id, name, roles: ["USER"] as string[], modules, sessionId: "pm-portfolios", ipAddress: null });
const db = () => getDbPool();
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
let owner: number;
let editor: number;
let viewer: number;
let outsider: number;
let shared: number; // a project the owner and the viewer see
let secret: number; // a private project only the owner sees
let portfolio: number;

const newProject = async (name: string, as: number, privacy = "PRIVATE") => {
  const created = await work.createProject({ name, description: "", color: "blue", privacy, departmentId: null, defaultAccessRole: "VIEWER", defaultView: "LIST", startOn: "", dueOn: "" }, who(as));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
const task = async (title: string, project: number, as: number) => {
  const added = await work.quickAddTask({ title, projectId: project, sectionId: null, parentId: null, assigneeId: null, dueDay: await workingDayFrom(10), mySectionId: null }, who(as));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
const newPortfolio = async (name: string, as = owner, extra: Record<string, unknown> = {}) => {
  const created = await portfolios.createPortfolio({ name, ...extra }, who(as));
  if (!created.ok) throw new Error(created.message);
  return created.value.id;
};
// Messages waiting in (or sent from) the outbox of one kind, to one person or anyone.
const notices = async (type: string, userId?: number) => {
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.eventType')) = ?${userId ? " AND JSON_EXTRACT(payload_json, '$.userId') = ?" : ""}`,
    userId ? [type, userId] : [type],
  );
  return Number(rows[0]?.n ?? 0);
};

beforeAll(async () => {
  await setting("features.pm_portfolios", "ON");
  owner = await createUser({ name: `Pf owner ${tag}` });
  editor = await createUser({ name: `Pf editor ${tag}` });
  viewer = await createUser({ name: `Pf viewer ${tag}` });
  outsider = await createUser({ name: `Pf outsider ${tag}` });
  shared = await newProject(`Shared ${tag}`, owner);
  expect((await work.setMember(shared, { type: "USER", id: viewer }, "VIEWER", who(owner))).ok).toBe(true);
  expect((await work.setMember(shared, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
  secret = await newProject(`Secret ${tag}`, owner);
  // Shared: 3 tasks, 1 done. Secret: 4 tasks, 3 done.
  const a = await task(`S1 ${tag}`, shared, owner);
  await task(`S2 ${tag}`, shared, owner);
  await task(`S3 ${tag}`, shared, owner);
  const secrets = [await task(`X1 ${tag}`, secret, owner), await task(`X2 ${tag}`, secret, owner), await task(`X3 ${tag}`, secret, owner), await task(`X4 ${tag}`, secret, owner)];
  await db().query("UPDATE tasks SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP() WHERE id IN (?)", [[a, ...secrets.slice(0, 3)]]);
});
afterAll(async () => {
  await db().query("DELETE FROM system_settings WHERE setting_key = 'features.pm_portfolios'");
});

describe("create and people", () => {
  it("creates a private portfolio with projects and people; the creator owns it; people are told", async () => {
    portfolio = await newPortfolio(`Pf ${tag}`, owner, { color: "teal", projectIds: [shared, secret], members: [{ id: editor, role: "EDITOR" }, { id: viewer, role: "VIEWER" }] });
    const view = await portfolios.loadPortfolio(portfolio, who(owner));
    expect(view?.role).toBe("OWNER");
    expect(view?.rows).toHaveLength(2);
    expect(view?.members.map((member) => member.role).sort()).toEqual(["EDITOR", "OWNER", "VIEWER"]);
    expect(await notices("WORK_PORTFOLIO_MEMBER", editor)).toBe(1);
    expect(await notices("WORK_PORTFOLIO_MEMBER", owner)).toBe(0);
  });
  it("refuses a name that is empty and work the creator can't see", async () => {
    expect((await portfolios.createPortfolio({ name: "  " }, who(owner))).ok).toBe(false);
    const refused = await portfolios.createPortfolio({ name: `Sneaky ${tag}`, projectIds: [secret] }, who(outsider));
    expect(refused.ok).toBe(false);
  });
  it("a private portfolio is not found for an outsider; no one without the Projects module sees it", async () => {
    expect(await portfolios.loadPortfolio(portfolio, who(outsider))).toBeNull();
    expect(await portfolios.loadPortfolio(portfolio, who(viewer, "V", ["APPROVAL", "TASK"]))).toBeNull();
    expect((await portfolios.addWork(portfolio, { projectId: shared }, who(outsider))).message).toBe("Not found.");
  });
  it("editors add people but not owners; owners can't all leave", async () => {
    expect((await portfolios.setPortfolioMember(portfolio, outsider, "OWNER", who(editor))).ok).toBe(false);
    expect((await portfolios.setPortfolioMember(portfolio, outsider, "VIEWER", who(editor))).ok).toBe(true);
    expect((await portfolios.setPortfolioMember(portfolio, outsider, null, who(editor))).ok).toBe(true);
    expect((await portfolios.portfolioCommand(portfolio, "LEAVE", who(owner))).ok).toBe(false);
    expect((await portfolios.setPortfolioMember(portfolio, viewer, "EDITOR", who(viewer))).ok).toBe(false);
  });
  it("only owners rename; editors may change the colour", async () => {
    expect((await portfolios.updatePortfolio(portfolio, { name: "Renamed" }, who(editor))).ok).toBe(false);
    expect((await portfolios.updatePortfolio(portfolio, { color: "purple" }, who(editor))).ok).toBe(true);
    expect((await portfolios.updatePortfolio(portfolio, { name: `Pf ${tag}`, dueOn: "2027-03-31", description: "Plant upgrades" }, who(owner))).ok).toBe(true);
  });
});

describe("deny by default: masking and roll-ups", () => {
  it("the owner sees both rows with their task progress", async () => {
    const view = (await portfolios.loadPortfolio(portfolio, who(owner)))!;
    const byName = new Map(view.rows.filter((row) => !row.masked).map((row) => [!row.masked ? row.name : "", row]));
    const s = byName.get(`Shared ${tag}`)!;
    const x = byName.get(`Secret ${tag}`)!;
    expect(!s.masked && s.counts).toMatchObject({ total: 3, completed: 1 });
    expect(!x.masked && x.counts).toMatchObject({ total: 4, completed: 3 });
    expect(view.totals).toMatchObject({ total: 7, completed: 4, projects: 2 });
  });
  it("a viewer of the portfolio sees the secret project only as a private row, with no details, and figures without it", async () => {
    const view = (await portfolios.loadPortfolio(portfolio, who(viewer)))!;
    expect(view.hidden).toBe(1);
    const hidden = view.rows.find((row) => row.masked)!;
    expect(hidden).toEqual({ itemId: hidden.itemId, kind: "PROJECT", masked: true, addedByName: expect.any(String), addedAt: expect.any(String) });
    expect(JSON.stringify(view.rows)).not.toContain(`Secret ${tag}`);
    expect(view.totals).toMatchObject({ total: 3, completed: 1, projects: 1 });
    const dashboard = await portfolios.loadDashboard(view, who(viewer));
    expect(dashboard.find((widget) => widget.key === "total")?.data.total).toBe(3);
    expect(JSON.stringify(dashboard)).not.toContain(`Secret ${tag}`);
  });
  it("seeing the portfolio opens no project: the secret project stays not found for the viewer", async () => {
    const { projectFor } = await import("@/lib/db/repositories/work.repository");
    const { workViewer } = await import("@/server/work/task-access");
    expect(await projectFor(secret, await workViewer(who(viewer)))).toBeNull();
  });
  it("a viewer can't change rows; an editor can't set a value on a row they can't see", async () => {
    const view = (await portfolios.loadPortfolio(portfolio, who(editor)))!;
    const hidden = view.rows.find((row) => row.masked)!;
    const visible = view.rows.find((row) => !row.masked)!;
    expect((await portfolios.setPriority(portfolio, visible.itemId, "HIGH", who(viewer))).ok).toBe(false);
    expect((await portfolios.setPriority(portfolio, hidden.itemId, "HIGH", who(editor))).message).toBe("Not found.");
    expect((await portfolios.setPriority(portfolio, visible.itemId, "HIGH", who(editor))).ok).toBe(true);
  });
  it("an editor can't add a project they can't see; a duplicate is refused", async () => {
    expect((await portfolios.addWork(portfolio, { projectId: secret }, who(editor))).message).toBe("Not found.");
    expect((await portfolios.addWork(portfolio, { projectId: shared }, who(owner))).message).toBe("That item is already in this portfolio.");
  });
});

describe("nesting", () => {
  it("nests portfolios, refuses itself, circles and more than 5 levels", async () => {
    const levels = [portfolio];
    for (let index = 2; index <= 5; index += 1) {
      const child = await newPortfolio(`Level ${index} ${tag}`);
      expect((await portfolios.addWork(levels.at(-1)!, { portfolioId: child }, who(owner))).ok).toBe(true);
      levels.push(child);
    }
    const sixth = await newPortfolio(`Level 6 ${tag}`);
    expect((await portfolios.addWork(levels[4]!, { portfolioId: sixth }, who(owner))).message).toBe("Portfolios go at most 5 levels deep.");
    expect((await portfolios.addWork(levels[2]!, { portfolioId: levels[2]! }, who(owner))).message).toBe("A portfolio can't contain itself.");
    expect((await portfolios.addWork(levels[3]!, { portfolioId: portfolio }, who(owner))).message).toContain("already contains this one");
  });
  it("a sub-portfolio rolls up its own projects; one the person can't see is masked", async () => {
    const child = await newPortfolio(`Child ${tag}`, owner, { projectIds: [shared] });
    await portfolios.addWork(portfolio, { portfolioId: child }, who(owner));
    const ownerView = (await portfolios.loadPortfolio(portfolio, who(owner)))!;
    const row = ownerView.rows.find((item) => !item.masked && item.kind === "PORTFOLIO" && item.name === `Child ${tag}`);
    expect(row && !row.masked && row.counts.total).toBe(3);
    const viewerView = (await portfolios.loadPortfolio(portfolio, who(viewer)))!;
    expect(viewerView.rows.filter((item) => item.masked && item.kind === "PORTFOLIO").length).toBeGreaterThanOrEqual(1);
  });
});

describe("columns, status updates and notices", () => {
  it("adds a single-select column and checks values", async () => {
    const added = await portfolios.addField(portfolio, { name: "Phase", kind: "SELECT", options: ["Plan", "Build"] }, who(editor));
    expect(added.ok).toBe(true);
    const fieldId = added.ok ? added.value.id : 0;
    const view = (await portfolios.loadPortfolio(portfolio, who(editor)))!;
    const visible = view.rows.find((row) => !row.masked)!;
    expect((await portfolios.setFieldValue(portfolio, visible.itemId, fieldId, "Ship", who(editor))).ok).toBe(false);
    expect((await portfolios.setFieldValue(portfolio, visible.itemId, fieldId, "Build", who(editor))).ok).toBe(true);
    const after = (await portfolios.loadPortfolio(portfolio, who(viewer)))!;
    const row = after.rows.find((item) => item.itemId === visible.itemId);
    expect(row && !row.masked && row.values[fieldId]).toBe("Build");
    expect((await portfolios.addField(portfolio, { name: "Status", kind: "TEXT" }, who(editor))).ok).toBe(false);
  });
  it("posts a status update (editors only), needs some words, and tells the members", async () => {
    expect((await portfolios.postStatus(portfolio, { status: "AT_RISK", title: "Late", body: "" }, who(viewer))).ok).toBe(false);
    expect((await portfolios.postStatus(portfolio, { status: "AT_RISK", title: "", body: "" }, who(editor))).ok).toBe(false);
    expect((await portfolios.postStatus(portfolio, { status: "AT_RISK", title: "Vendor late", body: "" }, who(editor))).ok).toBe(true);
    const view = (await portfolios.loadPortfolio(portfolio, who(owner)))!;
    expect(view.portfolio.currentStatus).toBe("AT_RISK");
    expect(await notices("WORK_PORTFOLIO_STATUS", owner)).toBe(1);
    expect(await notices("WORK_PORTFOLIO_STATUS", editor)).toBe(0);
  });
  it("a project set to Off track tells the portfolio owner who can see it", async () => {
    expect((await work.postStatus(shared, { status: "OFF_TRACK", title: "Stuck", body: "" }, who(editor))).ok).toBe(true);
    // Shared is in two of the owner's portfolios (the first one and "Child"): one notice for each.
    expect(await notices("WORK_PORTFOLIO_ALERT", owner)).toBe(2);
    // The one who set it isn't told; a viewer of the portfolio who isn't its owner isn't either.
    expect(await notices("WORK_PORTFOLIO_ALERT", editor)).toBe(0);
    expect(await notices("WORK_PORTFOLIO_ALERT", viewer)).toBe(0);
  });
});

describe("the switch and the purge", () => {
  it("with the switch off nothing is found and nothing changes", async () => {
    await setting("features.pm_portfolios", "OFF");
    try {
      expect(await portfolios.loadPortfolio(portfolio, who(owner))).toBeNull();
      expect((await portfolios.createPortfolio({ name: "Off" }, who(owner))).ok).toBe(false);
    } finally {
      await setting("features.pm_portfolios", "ON");
    }
  });
  it("a deleted portfolio is restorable; after 30 days it is purged, its projects stay", async () => {
    const doomed = await newPortfolio(`Doomed ${tag}`, owner, { projectIds: [shared] });
    await portfolios.addField(doomed, { name: "Notes", kind: "TEXT" }, who(owner));
    await portfolios.postStatus(doomed, { status: "ON_TRACK", title: "Fine" }, who(owner));
    await portfolios.portfolioCommand(doomed, "STAR", who(owner));
    expect((await portfolios.portfolioCommand(doomed, "DELETE", who(editor))).ok).toBe(false);
    expect((await portfolios.portfolioCommand(doomed, "DELETE", who(owner))).ok).toBe(true);
    expect(await portfolios.loadPortfolio(doomed, who(owner))).toBeNull();
    expect((await portfolios.portfolioCommand(doomed, "RESTORE", who(owner))).ok).toBe(true);
    expect(await portfolios.loadPortfolio(doomed, who(owner))).not.toBeNull();
    await portfolios.portfolioCommand(doomed, "DELETE", who(owner));
    await portfolios.addWork(portfolio, { portfolioId: doomed }, who(owner)).catch(() => undefined);
    await db().query("UPDATE portfolios SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 DAY) WHERE id = ?", [doomed]);
    const result = await runWorkPurge({ force: true });
    expect(result.purgedPortfolios).toBeGreaterThanOrEqual(1);
    const [left] = await db().query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM portfolios WHERE id = ?) AS p, (SELECT COUNT(*) FROM portfolio_items WHERE portfolio_id = ? OR child_portfolio_id = ?) AS i, (SELECT COUNT(*) FROM projects WHERE id = ?) AS project", [doomed, doomed, doomed, shared]);
    expect(left[0]).toMatchObject({ p: 0, i: 0, project: 1 });
  });
  it("a purged project leaves every portfolio (with its column values)", async () => {
    const gone = await newProject(`Gone ${tag}`, owner);
    const added = await portfolios.addWork(portfolio, { projectId: gone }, who(owner));
    expect(added.ok).toBe(true);
    const field = await portfolios.addField(portfolio, { name: `Budget ${tag}`.slice(0, 80), kind: "NUMBER" }, who(owner));
    if (added.ok && field.ok) expect((await portfolios.setFieldValue(portfolio, added.value.itemId, field.value.id, "1200.5", who(owner))).ok).toBe(true);
    expect((await work.setProjectLifecycle(gone, "DELETE", who(owner))).ok).toBe(true);
    // A deleted project drops out of the rows at once (it comes back if restored).
    expect((await portfolios.loadPortfolio(portfolio, who(owner)))!.rows.some((row) => !row.masked && row.id === gone)).toBe(false);
    await db().query("UPDATE projects SET deleted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 31 DAY) WHERE id = ?", [gone]);
    await runWorkPurge({ force: true });
    const [left] = await db().query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM projects WHERE id = ?) AS p, (SELECT COUNT(*) FROM portfolio_items WHERE project_id = ?) AS i", [gone, gone]);
    expect(left[0]).toMatchObject({ p: 0, i: 0 });
  });
});
