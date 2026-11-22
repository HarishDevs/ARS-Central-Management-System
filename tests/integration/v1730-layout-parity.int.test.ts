import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import * as work from "@/server/work/service";
import * as repo from "@/lib/db/repositories/work.repository";
import { workViewer } from "@/server/work/task-access";
import { createUser } from "./helpers";

// v1.73.0 (D-396): the project header's inline title (spec PM §3.6). Only
// the project's owners rename it; the name is checked like the details form
// (2 to 150 characters, spaces tidied); the change is in the project's
// history and the audit log; an unchanged name changes nothing.
const tag = Date.now().toString(36);
const who = (id: number, roles: string[] = ["USER"]) => ({ id, name: `P${id}`, roles });
let owner: number;
let editor: number;
let outsider: number;
let projectId: number;

async function nameOf(id: number) {
  return (await repo.projectFor(id, await workViewer(who(owner))))?.project.name;
}

beforeAll(async () => {
  owner = await createUser({ name: `Owner ${tag}` });
  editor = await createUser({ name: `Editor ${tag}` });
  outsider = await createUser({ name: `Outsider ${tag}` });
  const created = await work.createProject({ name: `Rename me ${tag}`, description: "", color: "blue", privacy: "PRIVATE", departmentId: null, defaultAccessRole: "COMMENTER", defaultView: "LIST", startOn: "", dueOn: "" }, who(owner));
  projectId = created.ok ? created.value.id : 0;
  expect((await work.setMember(projectId, { type: "USER", id: editor }, "EDITOR", who(owner))).ok).toBe(true);
});

afterAll(async () => {
  await getDbPool().end();
});

describe("Rename a project from its header (D-396)", () => {
  it("an owner renames it; spaces are tidied; history and audit record it", async () => {
    const result = await work.renameProject(projectId, `  Renamed   project ${tag} `, who(owner));
    expect(result.ok).toBe(true);
    expect(await nameOf(projectId)).toBe(`Renamed project ${tag}`);
    const [events] = await getDbPool().query<RowDataPacket[]>("SELECT body FROM project_events WHERE project_id = ? AND event_type = 'DETAILS' ORDER BY id DESC LIMIT 1", [projectId]);
    expect(String(events[0]?.body)).toContain(`Renamed project ${tag}`);
    const [audit] = await getDbPool().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'PROJECT_UPDATED' AND entity_id = ? AND actor_user_id = ?", [String(projectId), owner]);
    expect(Number(audit[0]?.n)).toBeGreaterThan(0);
  });

  it("an editor can't rename it, and someone who can't see it gets 'not found'", async () => {
    const byEditor = await work.renameProject(projectId, `Editor's name ${tag}`, who(editor));
    expect(byEditor.ok).toBe(false);
    if (!byEditor.ok) expect(byEditor.message).toMatch(/owners/);
    const byOutsider = await work.renameProject(projectId, `Outsider's name ${tag}`, who(outsider));
    expect(byOutsider.ok).toBe(false);
    if (!byOutsider.ok) expect(byOutsider.message).toMatch(/not found/i);
    expect(await nameOf(projectId)).toBe(`Renamed project ${tag}`);
  });

  it("a name shorter than 2 characters is refused; the same name changes nothing", async () => {
    const short = await work.renameProject(projectId, " x ", who(owner));
    expect(short.ok).toBe(false);
    const [before] = await getDbPool().query<RowDataPacket[]>("SELECT row_version FROM projects WHERE id = ?", [projectId]);
    const same = await work.renameProject(projectId, `Renamed project ${tag}`, who(owner));
    expect(same.ok).toBe(true);
    const [after] = await getDbPool().query<RowDataPacket[]>("SELECT row_version FROM projects WHERE id = ?", [projectId]);
    expect(after[0]?.row_version).toBe(before[0]?.row_version);
    expect(await nameOf(projectId)).toBe(`Renamed project ${tag}`);
  });
});
