import { describe, expect, it } from "vitest";
import { samePackageFile } from "@/server/ops/backup-centre/service";

// v1.85.1 (D-413): the checked package is recognised although the run's JSON
// column kept its modified time to fewer digits; a real change is not.
describe("samePackageFile (D-413)", () => {
  it("accepts the time as MySQL gives it back", () => {
    expect(samePackageFile({ size: 293527, mtimeMs: 1795413084926.7817 }, { size: 293527, mtime: 1795413084926.7815 })).toBe(true);
  });
  it("refuses another size or a later time", () => {
    expect(samePackageFile({ size: 293528, mtimeMs: 1795413084926.7817 }, { size: 293527, mtime: 1795413084926.7817 })).toBe(false);
    expect(samePackageFile({ size: 293527, mtimeMs: 1795413085926.7817 }, { size: 293527, mtime: 1795413084926.7817 })).toBe(false);
    expect(samePackageFile({ size: 293527, mtimeMs: 1795413084926.7817 }, {})).toBe(false);
  });
});
