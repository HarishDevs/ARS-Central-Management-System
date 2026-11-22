import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import * as repo from "@/lib/db/repositories/work.repository";
import * as autoRepo from "@/lib/db/repositories/automations.repository";
import * as formsRepo from "@/lib/db/repositories/intake-forms.repository";
import * as reportingRepo from "@/lib/db/repositories/reporting.repository";
import * as fieldsRepo from "@/lib/db/repositories/fields.repository";
import * as work from "@/server/work/service";
import * as fieldsService from "@/server/work/fields-service";
import * as templates from "@/server/work/templates";
import * as io from "@/server/work/project-io";
import * as feeds from "@/server/work/calendar-feeds";
import { readDuplicateChoice, DEFAULT_DUPLICATE } from "@/server/work/template-rules";
import { indiaDay } from "@/server/work/rules";
import { addDays } from "@/server/work/schedule";
import { GET as feedRoute } from "@/app/api/calendar/[token]/route";
import type { ModuleCode } from "@/server/modules/modules";
import { createUser } from "./helpers";

// v1.70.0 (D-383, PM phase E part 1) through the services: a complete
// template and a project from it (sections, subtasks with dates as offsets,
// every field type with values, dependencies with types, tabs, dashboard,
// automations as drafts, forms as drafts, placeholders), Duplicate with
// choices, the gallery (organisation templates, rename, delete), import
// (rights, mapping, error rows, limits), export, and calendar feeds (token,
// rotate, revoke, visibility at request time). The switch refuses all of it.
const tag = Date.now().toString(36);
const ALL: ModuleCode[] = ["APPROVAL", "TASK", "PROJECT"];
const who = (id: number, name = `E${id}`, roles: string[] = ["USER"]) => ({ id, name, roles, modules: ALL, sessionId: "pm-extras", ipAddress: null });
const db = () => getDbPool();
const SWITCHES = ["pm_planning", "pm_reporting", "pm_forms", "pm_automations", "pm_extras"];
const setting = (key: string, value: string) =>
  db().query("INSERT INTO system_settings (setting_key, setting_group, value_type, encrypted, value) VALUES (?, 'FEATURES', 'STRING', FALSE, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, value]);
const rows = async (sql: string, params: unknown[] = []) => (await db().query<RowDataPacket[]>(sql, params))[0];
let owner: number;
let helper: number;
let viewer: number;
let outsider: number;
let itAdmin: number;
let source: number;
let start: string;
let templateId: number;
const ids = {} as Record<"plan" | "build" | "stage" | "review" | "amount" | "double" | "kickoff" | "agenda" | "build1" | "form", number>;

const task = async (title: string, project: number, as: number, extra: { parentId?: number; assigneeId?: number; dueDay?: string; sectionId?: number } = {}) => {
  const added = await work.quickAddTask({ title, projectId: extra.parentId ? null : project, sectionId: extra.sectionId ?? null, parentId: extra.parentId ?? null, assigneeId: extra.assigneeId ?? null, dueDay: extra.dueDay ?? addDays(start, 10), mySectionId: null, holidayOk: true }, who(as));
  if (!added.ok) throw new Error(added.message);
  return added.value.id;
};
const field = async (project: number, input: Record<string, unknown>) => {
  const made = await fieldsService.createField(project, input, who(owner));
  if (!made.ok) throw new Error(made.message);
  return made.value.id;
};
const csvFile = (text: string, name = "tasks.csv") => new File([text], name, { type: "text/csv" });

beforeAll(async () => {
  for (const name of SWITCHES) await setting(`features.${name}`, "ON");
  owner = await createUser({ name: `Ex owner ${tag}` });
  helper = await createUser({ name: `Ex helper ${tag}` });
  viewer = await createUser({ name: `Ex viewer ${tag}` });
  outsider = await createUser({ name: `Ex outsider ${tag}` });
  itAdmin = await createUser({ name: `Ex IT ${tag}`, roles: ["IT_ADMIN"] });
  start = addDays(indiaDay(new Date()), 3);
  const created = await work.createProject({ name: `Source ${tag}`, description: "The source", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "VIEWER", defaultView: "LIST", startOn: start, dueOn: "", sections: "Plan\nBuild\nShip" }, who(owner));
  if (!created.ok) throw new Error(created.message);
  source = created.value.id;
  await work.setMember(source, { type: "USER", id: helper }, "EDITOR", who(owner));
  await work.setMember(source, { type: "USER", id: viewer }, "VIEWER", who(owner));
  const sections = await repo.listSections(source);
  ids.plan = sections[0]!.id;
  ids.build = sections[1]!.id;
  ids.stage = await field(source, { name: "Stage", type: "SELECT", options: [{ name: "Draft", color: 1 }, { name: "Final", color: 2 }] });
  ids.review = await field(source, { name: "Review day", type: "DATE" });
  ids.amount = await field(source, { name: "Amount", type: "NUMBER" });
  ids.double = await field(source, { name: "Double", type: "FORMULA", config: { formula: `{f${ids.amount}} * 2` } });
  ids.kickoff = await task(`Kick-off ${tag}`, source, owner, { sectionId: ids.plan, dueDay: start });
  ids.agenda = await task(`Agenda ${tag}`, source, owner, { parentId: ids.kickoff, assigneeId: helper, dueDay: start });
  ids.build1 = await task(`Build ${tag}`, source, owner, { sectionId: ids.build, assigneeId: helper, dueDay: addDays(start, 9) });
  const stage = (await fieldsRepo.findField(ids.stage))!;
  expect((await fieldsService.setFieldValue(ids.kickoff, ids.stage, stage.options[1]!.id, who(owner))).ok).toBe(true);
  expect((await fieldsService.setFieldValue(ids.kickoff, ids.review, addDays(start, 5), who(owner))).ok).toBe(true);
  expect((await fieldsService.setFieldValue(ids.kickoff, ids.amount, "1200", who(owner))).ok).toBe(true);
  await db().query("INSERT INTO task_dependencies (blocker_task_id, blocked_task_id, dep_type, lag_days, created_by) VALUES (?, ?, 'SS', 0, ?)", [ids.kickoff, ids.build1, owner]);
  await withTransaction(async (connection) => {
    await repo.insertProjectTab(source, { type: "LIST", name: "List", config: {}, position: 1024, isDefault: true }, owner, connection);
    await repo.insertProjectTab(source, { type: "BOARD", name: "By stage", config: { groupField: ids.stage, fieldFilters: [{ fieldId: ids.stage, op: "is", value: String(stage.options[1]!.id) }] }, position: 2048 }, owner, connection);
    await repo.markProjectTabsSet(source, connection);
    await reportingRepo.insertWidget(source, { kind: "TEXT", title: `Read me ${tag}`, config: null, body: "Hello", size: "FULL" }, 1024, owner, connection);
    await reportingRepo.markDashboardSet(source, connection);
    const formId = await formsRepo.insertForm(
      { projectId: source, token: `tok${tag}`.padEnd(22, "x"), name: `Intake ${tag}`, description: null, draft: { fields: [{ key: "q", label: "Amount", type: "NUMBER", required: false } as never], mappings: { q: { kind: "FIELD", fieldId: ids.amount } } }, settings: { sectionId: ids.build } as never, createdBy: owner },
      connection,
    );
    await connection.query("UPDATE project_forms SET status = 'PUBLISHED' WHERE id = ?", [formId]);
    ids.form = formId;
    const ruleId = await autoRepo.insertRule({ projectId: source, name: `Rule ${tag}`, ownerId: owner, draft: { trigger: { type: "FORM_SUBMITTED", formId }, steps: [{ key: "a", type: "MOVE_TO_SECTION", sectionId: ids.build }], paths: [], otherwise: [] }, createdBy: owner }, connection);
    await autoRepo.publishRule(ruleId, { trigger: { type: "FORM_SUBMITTED", formId }, steps: [{ key: "a", type: "MOVE_TO_SECTION", sectionId: ids.build }], paths: [], otherwise: [] }, owner, connection);
  });
  await db().query("INSERT INTO project_status_updates (project_id, status, title, body, snapshot_json, author_id) VALUES (?, 'AT_RISK', ?, 'Slow', '{}', ?)", [source, `Week 1 ${tag}`, owner]);
});

afterAll(async () => {
  for (const name of SWITCHES.filter((item) => item === "pm_extras")) await db().query("DELETE FROM system_settings WHERE setting_key = ?", [`features.${name}`]);
});

describe("save as template, then a project from it (fidelity)", () => {
  let made: number;
  it("only owners and editors save; the template holds every part", async () => {
    expect((await templates.saveTemplate(source, "Nope", who(viewer))).ok).toBe(false);
    expect((await templates.saveTemplate(source, "Nope", who(outsider))).ok).toBe(false);
    const saved = await templates.saveTemplate(source, `Launch template ${tag}`, who(owner));
    expect(saved.ok).toBe(true);
    templateId = saved.ok ? saved.value.id : 0;
    const shown = await templates.templateFor(templateId, who(owner));
    expect(shown?.item.summary).toMatchObject({ tasks: 3, sections: 3, fields: 4, dependencies: 1, tabs: 2, widgets: 1, forms: 1, automations: 1, placeholders: 2 });
    const kick = shown!.template.tasks.find((item) => item.title === `Kick-off ${tag}`)!;
    expect(kick.dueOffset).toBe(0);
    expect(kick.subtasks[0]!.title).toBe(`Agenda ${tag}`);
    expect(kick.values[String(ids.review)]).toEqual({ dateOffset: 5, time: null });
    expect(kick.values[String(ids.stage)]).toEqual({ option: "Final" });
    expect(kick.values[String(ids.double)]).toBeUndefined(); // worked out again
  });

  it("makes the project: sections, tasks with dates from the new start, values, links, tabs, dashboard; forms and automations as drafts", async () => {
    const newStart = addDays(start, 30);
    const shown = (await templates.templateFor(templateId, who(owner)))!;
    const helperKey = shown.template.placeholders.find((holder) => holder.userId === helper)!.key;
    const result = await templates.useTemplate(templateId, { name: `From template ${tag}`, startOn: newStart, privacy: "PRIVATE", departmentId: null, assign: { [helperKey]: viewer } }, who(owner));
    expect(result.ok).toBe(true);
    made = result.ok ? result.value.id : 0;
    expect(result.ok && result.value.tasks).toBe(3);
    expect((await repo.listSections(made)).map((section) => section.name)).toEqual(["Plan", "Build", "Ship"]);
    const fields = await fieldsRepo.listFieldDefs(made);
    expect(fields.map((item) => `${item.name}:${item.type}`)).toEqual(["Stage:SELECT", "Review day:DATE", "Amount:NUMBER", "Double:FORMULA"]);
    const amount = fields.find((item) => item.name === "Amount")!;
    expect(fields.find((item) => item.name === "Double")!.config.formula).toBe(`{f${amount.id}} * 2`);
    const tasks = await rows("SELECT t.id, t.title, t.assignee_id, t.due_at, t.parent_task_id FROM tasks t WHERE t.id IN (SELECT task_id FROM task_projects WHERE project_id = ?) OR t.root_task_id IN (SELECT task_id FROM task_projects WHERE project_id = ?)", [made, made]);
    const byTitle = new Map(tasks.map((row) => [String(row.title), row]));
    const kick = byTitle.get(`Kick-off ${tag}`)!;
    expect(indiaDay(kick.due_at as Date) >= newStart).toBe(true);
    expect(Number(byTitle.get(`Agenda ${tag}`)!.parent_task_id)).toBe(Number(kick.id));
    expect(Number(byTitle.get(`Agenda ${tag}`)!.assignee_id)).toBe(viewer); // the placeholder given to someone else
    expect(Number(kick.assignee_id)).toBe(owner);
    const values = await fieldsRepo.valueRows([Number(kick.id)]);
    const stage = fields.find((item) => item.name === "Stage")!;
    expect(values.get(Number(kick.id))!.get(stage.id)!.stored.optionId).toBe(stage.options.find((option) => option.name === "Final")!.id);
    const review = fields.find((item) => item.name === "Review day")!;
    expect(values.get(Number(kick.id))!.get(review.id)!.stored.date).toBe(addDays(newStart, 5));
    expect(values.get(Number(kick.id))!.get(amount.id)!.stored.number).toBe(1200);
    const links = await rows("SELECT dep_type FROM task_dependencies WHERE blocker_task_id = ? AND blocked_task_id = ?", [Number(kick.id), Number(byTitle.get(`Build ${tag}`)!.id)]);
    expect(links.map((row) => row.dep_type)).toEqual(["SS"]);
    const tabs = await repo.listProjectTabs(made);
    expect(tabs.tabsSet).toBe(true);
    const board = tabs.rows.find((tab) => tab.name === "By stage")!;
    expect((board.config as { groupField: number }).groupField).toBe(stage.id);
    expect((board.config as { fieldFilters: { fieldId: number; value: string }[] }).fieldFilters[0]).toMatchObject({ fieldId: stage.id, value: String(stage.options.find((option) => option.name === "Final")!.id) });
    expect((await reportingRepo.listWidgets(made)).map((widget) => widget.title)).toEqual([`Read me ${tag}`]);
    const forms = await formsRepo.listProjectForms(made);
    expect(forms).toHaveLength(1);
    expect(forms[0]!.status).toBe("DRAFT");
    expect(forms[0]!.draft.mappings.q).toEqual({ kind: "FIELD", fieldId: amount.id });
    expect(forms[0]!.settings.sectionId).toBe((await repo.listSections(made))[1]!.id);
    const rules = await autoRepo.listProjectRules(made);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.ownerId).toBe(owner);
    expect(rules[0]!.published).toBeNull(); // never published by a template
    expect(rules[0]!.draft.trigger?.formId).toBe(forms[0]!.id);
    expect(rules[0]!.draft.steps[0]!.sectionId).toBe((await repo.listSections(made))[1]!.id);
  });

  it("the person given the tasks gets one notice", async () => {
    const notices = await rows("SELECT COUNT(*) AS n FROM notification_outbox WHERE JSON_EXTRACT(payload_json, '$.userId') = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.eventType')) = 'WORK_TASK_ASSIGNED' AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.title')) LIKE ?", [viewer, `%From template ${tag}%`]);
    expect(Number(notices[0]!.n)).toBe(1);
  });
});

describe("the gallery", () => {
  it("others see a template only once IT makes it an organisation template", async () => {
    expect((await templates.gallery(who(outsider)))!.some((item) => item.id === templateId)).toBe(false);
    expect((await templates.useTemplate(templateId, { name: "x", startOn: "", privacy: "PRIVATE", departmentId: null, assign: {} }, who(outsider))).ok).toBe(false);
    expect((await templates.shareTemplate(templateId, true, who(owner))).ok).toBe(false);
    expect((await templates.shareTemplate(templateId, true, who(itAdmin, "IT", ["IT_ADMIN"]))).ok).toBe(true);
    const seen = (await templates.gallery(who(outsider)))!.find((item) => item.id === templateId);
    expect(seen).toMatchObject({ shared: true, mine: false, canManage: false });
    expect((await templates.renameTemplate(templateId, "Mine now", who(outsider))).ok).toBe(false);
    const used = await templates.useTemplate(templateId, { name: `Outsider copy ${tag}`, startOn: "", privacy: "PRIVATE", departmentId: null, assign: {} }, who(outsider));
    expect(used.ok).toBe(true);
  });
  it("the owner renames and deletes", async () => {
    expect((await templates.renameTemplate(templateId, `Launch kit ${tag}`, who(owner))).ok).toBe(true);
    expect((await templates.gallery(who(owner)))!.find((item) => item.id === templateId)?.name).toBe(`Launch kit ${tag}`);
    const spare = await templates.saveTemplate(source, `Spare ${tag}`, who(helper));
    const spareId = spare.ok ? spare.value.id : 0;
    expect((await templates.deleteTemplate(spareId, who(viewer))).ok).toBe(false);
    expect((await templates.deleteTemplate(spareId, who(helper))).ok).toBe(true);
    expect((await templates.gallery(who(helper)))!.some((item) => item.id === spareId)).toBe(false);
  });
});

describe("duplicate with choices", () => {
  it("copies the chosen parts and moves dates; status updates only when asked", async () => {
    expect((await templates.duplicateProject(source, { name: "x", privacy: "PRIVATE", departmentId: null }, readDuplicateChoice({}), who(viewer))).ok).toBe(false);
    const choice = readDuplicateChoice({ parts: { ...DEFAULT_DUPLICATE, subtasks: false, fields: false, automations: false, members: false }, shiftDays: 7 });
    const copy = await templates.duplicateProject(source, { name: `Copy ${tag}`, privacy: "PRIVATE", departmentId: null }, choice, who(helper));
    expect(copy.ok).toBe(true);
    const copyId = copy.ok ? copy.value.id : 0;
    expect(copy.ok && copy.value.tasks).toBe(2); // no subtasks
    expect(await fieldsRepo.listFieldDefs(copyId)).toEqual([]);
    expect(await autoRepo.listProjectRules(copyId)).toEqual([]);
    expect((await repo.listProjectMembers(copyId)).map((member) => member.id)).toEqual([helper]);
    expect(await repo.listStatusUpdates(copyId)).toEqual([]);
    const build = (await rows("SELECT t.due_at, t.assignee_id FROM tasks t JOIN task_projects tp ON tp.task_id = t.id WHERE tp.project_id = ? AND t.title = ?", [copyId, `Build ${tag}`]))[0]!;
    const due = indiaDay(build.due_at as Date);
    expect(due >= addDays(start, 16) && due <= addDays(start, 19)).toBe(true); // +7, then the next working day
    expect(Number(build.assignee_id)).toBe(helper); // assignees kept
    const full = await templates.duplicateProject(source, { name: `Full copy ${tag}`, privacy: "PRIVATE", departmentId: null }, readDuplicateChoice({ parts: { ...DEFAULT_DUPLICATE, statusUpdates: true } }), who(owner));
    const fullId = full.ok ? full.value.id : 0;
    expect((await repo.listStatusUpdates(fullId)).map((update) => update.title)).toEqual([`Week 1 ${tag}`]);
    expect((await repo.listProjectMembers(fullId)).map((member) => member.id).sort()).toEqual([owner, helper, viewer].sort());
    expect((await autoRepo.listProjectRules(fullId))[0]!.published).toBeNull();
  });
});

describe("export and import", () => {
  it("exports what the person sees; the full JSON only for owners and editors", async () => {
    const table = await io.exportTable(source, who(viewer));
    expect(table.ok).toBe(true);
    if (!table.ok) return;
    expect(table.value.header).toEqual(expect.arrayContaining(["Name", "Section", "Due date", "Stage", "Review day", "Amount", "Double"]));
    const kick = table.value.rows.find((row) => row[1] === `Kick-off ${tag}`)!;
    expect(kick[table.value.header.indexOf("Stage")]).toBe("Final");
    expect(table.value.rows.some((row) => row[1] === `Agenda ${tag}` && row[10] !== "")).toBe(true);
    expect(io.exportCsv(table.value).startsWith("﻿Task ID,Name")).toBe(true);
    expect(io.exportXlsx(table.value).length).toBeGreaterThan(500);
    expect((await io.exportTable(source, who(outsider))).ok).toBe(false);
    expect((await templates.projectJson(source, who(viewer))).ok).toBe(false);
    const json = await templates.projectJson(source, who(owner));
    expect(json.ok && json.value.body.version).toBe(2);
  });

  it("imports with a mapping: an error row is reported and skipped only when asked", async () => {
    const csv = `Task,Due,Who,Section,Stage\nImported one ${tag},15/12/2030,${(await rows("SELECT email FROM users WHERE id = ?", [helper]))[0]!.email},New bit,Draft\nBad row ${tag},someday,,,\n`;
    const mapping = JSON.stringify(["title", "due", "assignee", "section", `field:${ids.stage}`]);
    const form = (extra: Record<string, string> = {}) => {
      const data = new FormData();
      data.set("file", csvFile(csv));
      for (const [key, value] of Object.entries(extra)) data.set(key, value);
      return data;
    };
    expect((await io.previewImport(source, form(), who(viewer))).ok).toBe(false);
    const step1 = await io.previewImport(source, form(), who(owner));
    expect(step1.ok && step1.value.mapping).toEqual(["title", "due", "assignee", "section", `field:${ids.stage}`]);
    const dry = await io.previewImport(source, form({ mapping }), who(owner));
    expect(dry.ok && dry.value.plan).toMatchObject({ ready: 1, withErrors: 1, newSections: ["New bit"] });
    const refused = await io.runImport(source, form({ mapping }), who(owner));
    expect(refused.ok).toBe(false);
    const done = await io.runImport(source, form({ mapping, skipErrors: "on" }), who(owner));
    expect(done.ok && done.value).toMatchObject({ created: 1, skipped: 1, failed: [] });
    const made = (await rows("SELECT t.id, t.assignee_id, t.due_at FROM tasks t JOIN task_projects tp ON tp.task_id = t.id WHERE tp.project_id = ? AND t.title = ?", [source, `Imported one ${tag}`]))[0]!;
    expect(Number(made.assignee_id)).toBe(helper);
    expect(indiaDay(made.due_at as Date)).toBe("2030-12-15");
    expect((await repo.listSections(source)).map((section) => section.name)).toContain("New bit");
    const stage = (await fieldsRepo.valueRows([Number(made.id)])).get(Number(made.id))!.get(ids.stage)!;
    expect(stage.stored.optionId).toBe((await fieldsRepo.findField(ids.stage))!.options[0]!.id);
  });

  it("refuses too many rows and files that aren't CSV or Excel", async () => {
    const big = `Task,Due\n${Array.from({ length: 501 }, (_, index) => `T${index},2030-12-15`).join("\n")}\n`;
    const data = new FormData();
    data.set("file", csvFile(big));
    data.set("mapping", JSON.stringify(["title", "due"]));
    const result = await io.runImport(source, data, who(owner));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/at most 500/);
    const bad = new FormData();
    bad.set("file", new File(["x"], "evil.exe"));
    expect((await io.previewImport(source, bad, who(owner))).ok).toBe(false);
  });
});

describe("calendar feeds", () => {
  it("a person's My Tasks feed: secret address, rotate, revoke", async () => {
    const madeFeed = await feeds.makeFeed("MY_TASKS", null, who(helper));
    expect(madeFeed.ok).toBe(true);
    const url = madeFeed.ok ? madeFeed.value.url : "";
    const token = url.split("/").pop()!.replace(/\.ics$/, "");
    const stored = await rows("SELECT token_hash FROM calendar_feeds WHERE user_id = ? AND revoked_at IS NULL", [helper]);
    expect(String(stored[0]!.token_hash)).not.toContain(token); // only a hash is kept
    const response = await feedRoute(new Request(url), { params: Promise.resolve({ token: `${token}.ics` }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    const body = await response.text();
    expect(body).toContain(`Build ${tag}`);
    expect(body).not.toContain(`Kick-off ${tag}`); // not the helper's task
    expect((await feeds.currentFeed("MY_TASKS", null, who(helper)))?.lastUsedAt).not.toBeNull();
    const rotated = await feeds.makeFeed("MY_TASKS", null, who(helper));
    expect(await feeds.feedCalendar(token)).toBeNull(); // the old address stops
    const fresh = rotated.ok ? rotated.value.url.split("/").pop()!.replace(/\.ics$/, "") : "";
    expect(await feeds.feedCalendar(fresh)).toContain("BEGIN:VCALENDAR");
    expect((await feeds.revokeFeed("MY_TASKS", null, who(helper))).ok).toBe(true);
    expect(await feeds.feedCalendar(fresh)).toBeNull();
    expect((await feedRoute(new Request("http://localhost/api/calendar/x"), { params: Promise.resolve({ token: "short" }) })).status).toBe(404);
  });

  it("a project feed shows only what the person may see now, and stops when they lose access", async () => {
    expect((await feeds.makeFeed("PROJECT", source, who(outsider))).ok).toBe(false);
    const madeFeed = await feeds.makeFeed("PROJECT", source, who(viewer));
    const token = madeFeed.ok ? madeFeed.value.url.split("/").pop()!.replace(/\.ics$/, "") : "";
    const body = (await feeds.feedCalendar(token))!;
    expect(body).toContain(`Kick-off ${tag}`);
    expect(body).toContain(`Agenda ${tag}`);
    await work.setMember(source, { type: "USER", id: viewer }, null, who(owner));
    expect(await feeds.feedCalendar(token)).toBeNull();
    await work.setMember(source, { type: "USER", id: viewer }, "VIEWER", who(owner));
    expect(await feeds.feedCalendar(token)).not.toBeNull();
  });

  it("with the switch off everything is refused", async () => {
    const madeFeed = await feeds.makeFeed("MY_TASKS", null, who(owner));
    const token = madeFeed.ok ? madeFeed.value.url.split("/").pop()!.replace(/\.ics$/, "") : "";
    await setting("features.pm_extras", "OFF");
    try {
      expect(await feeds.feedCalendar(token)).toBeNull();
      expect((await templates.saveTemplate(source, "x", who(owner))).ok).toBe(false);
      expect(await templates.gallery(who(owner))).toBeNull();
      expect((await io.exportTable(source, who(owner))).ok).toBe(false);
      expect((await templates.duplicateProject(source, { name: "x", privacy: "PRIVATE", departmentId: null }, readDuplicateChoice({}), who(owner))).ok).toBe(false);
    } finally {
      await setting("features.pm_extras", "ON");
    }
  });
});
