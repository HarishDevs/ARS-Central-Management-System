import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getDbPool } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { applyTemplateVerdict, findActiveTemplate, markTemplateSubmitted, saveTemplateDraft, type TemplateVerdict } from "@/lib/db/repositories/whatsapp.repository";
import { createUser } from "./helpers";

// v1.57.6 (D-349, owner): WhatsApp template versions. One ACTIVE version per
// template_code (the newest approved), a pause clears approval and the
// previous approved version takes over, a rejected new version leaves the
// old one live. Each test uses its own code and event so nothing else is hit.
const approved: TemplateVerdict = { outcome: "APPROVED", metaStatus: "APPROVED", reason: null };
const paused: TemplateVerdict = { outcome: "PAUSED", metaStatus: "PAUSED", reason: "Low quality" };
const rejected: TemplateVerdict = { outcome: "REJECTED", metaStatus: "REJECTED", reason: "Bad wording" };

let adminId: number;
let counter = 0;
const createdIds: number[] = [];

beforeAll(async () => {
  adminId = await createUser({ name: "IT 1576", roles: ["USER", "IT_ADMIN", "SUPER_ADMIN"] });
});

afterAll(async () => {
  if (createdIds.length === 0) return;
  await getDbPool().query("DELETE FROM whatsapp_template_variables WHERE template_id IN (?)", [createdIds]);
  await getDbPool().query("DELETE FROM whatsapp_templates WHERE id IN (?)", [createdIds]);
});

// A fresh code/event with `count` submitted versions (1..count).
async function family(count: number) {
  counter += 1;
  const tag = `${Date.now().toString(36)}${counter}`;
  const code = `WA_V1576_${tag}`.toUpperCase();
  const eventType = `V1576_${tag}`.toUpperCase();
  const versions: { id: number; code: string; version: number }[] = [];
  for (let version = 1; version <= count; version += 1) {
    const id = await withTransaction(async (db) => {
      const newId = await saveTemplateDraft(
        { existingId: null, code, eventType, version, providerName: `ars_v1576_${tag}_v${version}`, category: "UTILITY", body: "Hi {{1}}", footer: null, variables: [{ key: "name", label: "Name" }] },
        adminId,
        db,
      );
      await markTemplateSubmitted(newId, adminId, db);
      return newId;
    });
    createdIds.push(id);
    versions.push({ id, code, version });
  }
  return { code, eventType, versions };
}

const verdict = (row: { id: number; code: string; version: number }, value: TemplateVerdict) => withTransaction((db) => applyTemplateVerdict(row, value, db));

async function states(code: string) {
  const [rows] = await getDbPool().query<(RowDataPacket & { version: number; status: string; approval_status: string; provider_status: string | null })[]>(
    "SELECT version, status, approval_status, provider_status FROM whatsapp_templates WHERE template_code = ? ORDER BY version",
    [code],
  );
  return rows.map((row) => ({ version: row.version, status: row.status, approval: row.approval_status, provider: row.provider_status }));
}

describe("v1.57.6 WhatsApp template version states (D-349)", () => {
  it("out-of-order approvals leave exactly one ACTIVE version, the newest", async () => {
    const { code, eventType, versions } = await family(3);
    const [v1, v2, v3] = versions as [(typeof versions)[0], (typeof versions)[0], (typeof versions)[0]];
    await verdict(v3, approved);
    await verdict(v1, approved);
    await verdict(v2, approved);
    expect(await states(code)).toEqual([
      { version: 1, status: "RETIRED", approval: "APPROVED", provider: "APPROVED" },
      { version: 2, status: "RETIRED", approval: "APPROVED", provider: "APPROVED" },
      { version: 3, status: "ACTIVE", approval: "APPROVED", provider: "APPROVED" },
    ]);
    expect(await findActiveTemplate(eventType)).toMatchObject({ id: v3.id });
  });

  it("pausing the ACTIVE version re-activates the previous approved one and clears approval on the paused one", async () => {
    const { code, eventType, versions } = await family(2);
    const [v1, v2] = versions as [(typeof versions)[0], (typeof versions)[0]];
    await verdict(v1, approved);
    await verdict(v2, approved);
    expect(await findActiveTemplate(eventType)).toMatchObject({ id: v2.id });
    await verdict(v2, paused);
    expect(await states(code)).toEqual([
      { version: 1, status: "ACTIVE", approval: "APPROVED", provider: "APPROVED" },
      { version: 2, status: "DRAFT", approval: "PENDING", provider: "PAUSED" },
    ]);
    expect(await findActiveTemplate(eventType)).toMatchObject({ id: v1.id });
    // Meta lifts the pause: the newer version is live again.
    await verdict(v2, approved);
    expect(await findActiveTemplate(eventType)).toMatchObject({ id: v2.id });
    expect((await states(code)).filter((row) => row.status === "ACTIVE")).toHaveLength(1);
  });

  it("a rejected new version leaves the old one ACTIVE", async () => {
    const { code, eventType, versions } = await family(2);
    const [v1, v2] = versions as [(typeof versions)[0], (typeof versions)[0]];
    await verdict(v1, approved);
    await verdict(v2, rejected);
    expect(await states(code)).toEqual([
      { version: 1, status: "ACTIVE", approval: "APPROVED", provider: "APPROVED" },
      { version: 2, status: "DRAFT", approval: "REJECTED", provider: "REJECTED" },
    ]);
    expect(await findActiveTemplate(eventType)).toMatchObject({ id: v1.id });
  });
});
