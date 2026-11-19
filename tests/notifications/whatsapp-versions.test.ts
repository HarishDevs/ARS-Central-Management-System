import { describe, expect, it } from "vitest";
import { nextTemplateStates, type TemplateVerdict, type VersionState } from "@/lib/db/repositories/whatsapp.repository";

// v1.57.6 (D-349, owner): one ACTIVE WhatsApp template version per code, the
// newest approved one; a pause clears approval and the previous approved
// version takes over.
const v = (version: number, status: VersionState["status"], approvalStatus: VersionState["approvalStatus"], providerStatus: string | null = null): VersionState => ({
  id: version * 10,
  version,
  status,
  approvalStatus,
  providerStatus,
});
const approved: TemplateVerdict = { outcome: "APPROVED", metaStatus: "APPROVED", reason: null };
const paused: TemplateVerdict = { outcome: "PAUSED", metaStatus: "PAUSED", reason: "Low quality" };
const rejected: TemplateVerdict = { outcome: "REJECTED", metaStatus: "REJECTED", reason: "Bad wording" };
const pending: TemplateVerdict = { outcome: "PENDING", metaStatus: "PENDING", reason: null };

describe("nextTemplateStates", () => {
  it("approving the first version makes it ACTIVE", () => {
    expect(nextTemplateStates([v(1, "DRAFT", "PENDING", "SUBMITTED")], 10, approved)).toEqual([{ id: 10, status: "ACTIVE", approvalStatus: "APPROVED" }]);
  });

  it("approving a newer version makes it ACTIVE and retires the old one", () => {
    const rows = [v(1, "ACTIVE", "APPROVED", "APPROVED"), v(2, "DRAFT", "PENDING", "SUBMITTED")];
    expect(nextTemplateStates(rows, 20, approved)).toEqual([
      { id: 20, status: "ACTIVE", approvalStatus: "APPROVED" },
      { id: 10, status: "RETIRED", approvalStatus: "APPROVED" },
    ]);
  });

  it("an older version approved after a newer one is recorded APPROVED but RETIRED", () => {
    const rows = [v(1, "DRAFT", "PENDING", "SUBMITTED"), v(2, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 10, approved)).toEqual([{ id: 10, status: "RETIRED", approvalStatus: "APPROVED" }]);
  });

  it("re-approving the live version changes nothing", () => {
    expect(nextTemplateStates([v(1, "RETIRED", "APPROVED", "APPROVED"), v(2, "ACTIVE", "APPROVED", "APPROVED")], 20, approved)).toEqual([]);
  });

  it("repairs two ACTIVE versions down to the newest", () => {
    const rows = [v(1, "ACTIVE", "APPROVED", "APPROVED"), v(2, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 20, approved)).toEqual([{ id: 10, status: "RETIRED", approvalStatus: "APPROVED" }]);
  });

  it("pausing the live version clears its approval and re-activates the previous approved one", () => {
    const rows = [v(1, "RETIRED", "APPROVED", "APPROVED"), v(2, "RETIRED", "APPROVED", "APPROVED"), v(3, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 30, paused)).toEqual([
      { id: 30, status: "DRAFT", approvalStatus: "PENDING" },
      { id: 20, status: "ACTIVE", approvalStatus: "APPROVED" },
    ]);
  });

  it("the fallback skips versions paused or rejected at Meta (including old rows still marked APPROVED)", () => {
    const rows = [v(1, "RETIRED", "APPROVED", "APPROVED"), v(2, "DRAFT", "APPROVED", "PAUSED"), v(3, "DRAFT", "REJECTED", "REJECTED"), v(4, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 40, { outcome: "PAUSED", metaStatus: "DISABLED", reason: null })).toEqual([
      { id: 40, status: "DRAFT", approvalStatus: "PENDING" },
      { id: 10, status: "ACTIVE", approvalStatus: "APPROVED" },
    ]);
  });

  it("rejecting the live version also falls back", () => {
    const rows = [v(1, "RETIRED", "APPROVED", "APPROVED"), v(2, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 20, rejected)).toEqual([
      { id: 20, status: "DRAFT", approvalStatus: "REJECTED" },
      { id: 10, status: "ACTIVE", approvalStatus: "APPROVED" },
    ]);
  });

  it("a rejected new version leaves the old one ACTIVE", () => {
    const rows = [v(1, "ACTIVE", "APPROVED", "APPROVED"), v(2, "DRAFT", "PENDING", "SUBMITTED")];
    expect(nextTemplateStates(rows, 20, rejected)).toEqual([{ id: 20, status: "DRAFT", approvalStatus: "REJECTED" }]);
  });

  it("pausing the only version leaves nothing ACTIVE", () => {
    expect(nextTemplateStates([v(1, "ACTIVE", "APPROVED", "APPROVED")], 10, paused)).toEqual([{ id: 10, status: "DRAFT", approvalStatus: "PENDING" }]);
  });

  it("pausing a retired fallback clears its approval without touching the live one", () => {
    const rows = [v(1, "RETIRED", "APPROVED", "APPROVED"), v(2, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 10, paused)).toEqual([{ id: 10, status: "DRAFT", approvalStatus: "PENDING" }]);
  });

  it("a paused version approved again by Meta becomes live again if it is the newest", () => {
    const rows = [v(1, "ACTIVE", "APPROVED", "APPROVED"), v(2, "DRAFT", "PENDING", "PAUSED")];
    expect(nextTemplateStates(rows, 20, approved)).toEqual([
      { id: 20, status: "ACTIVE", approvalStatus: "APPROVED" },
      { id: 10, status: "RETIRED", approvalStatus: "APPROVED" },
    ]);
  });

  it("a pending verdict changes no status", () => {
    expect(nextTemplateStates([v(1, "ACTIVE", "APPROVED", "APPROVED"), v(2, "DRAFT", "PENDING", "SUBMITTED")], 20, pending)).toEqual([]);
  });

  it("an unknown version id changes nothing", () => {
    expect(nextTemplateStates([v(1, "ACTIVE", "APPROVED", "APPROVED")], 99, paused)).toEqual([]);
  });
});

// v1.57.7 (D-350, owner): a retired approved version that Meta no longer lists.
describe("a fallback version deleted at Meta", () => {
  const gone: TemplateVerdict = { outcome: "GONE", metaStatus: "DELETED", reason: "No longer listed at Meta" };
  it("loses its approval but stays Replaced (RETIRED); the live version is untouched", () => {
    const rows = [v(1, "RETIRED", "APPROVED", "APPROVED"), v(2, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 10, gone)).toEqual([{ id: 10, status: "RETIRED", approvalStatus: "PENDING" }]);
  });
  it("is never brought back when the live version is later paused", () => {
    const rows = [v(1, "RETIRED", "PENDING", "DELETED"), v(2, "ACTIVE", "APPROVED", "APPROVED")];
    expect(nextTemplateStates(rows, 20, paused)).toEqual([{ id: 20, status: "DRAFT", approvalStatus: "PENDING" }]);
  });
});
