import { describe, expect, it } from "vitest";
import { checkValue, DEFAULT_CONFIG, type FieldDef } from "@/server/work/custom-fields";
import { realDay } from "@/server/work/rules";

// v1.71.2 QA fixes (D-393): QA logic #7, #8 and #11.
const def = (over: Partial<FieldDef>): FieldDef => ({ id: 1, name: "Field", type: "TEXT", config: DEFAULT_CONFIG, options: [], ...over });
const options = [
  { id: 11, name: "Open", color: 1, archived: false },
  { id: 12, name: "Old", color: 2, archived: true },
];

describe("a NUMBER of symbols only is not 0 (QA logic #7)", () => {
  it("refuses ₹, % and , alone; still reads ₹ 1,200 and 12.5%", () => {
    for (const value of ["₹", "%", ",", "₹ %"]) expect(checkValue(def({ type: "NUMBER" }), value)).toEqual({ ok: false, message: "Enter a number." });
    expect(checkValue(def({ type: "NUMBER" }), "₹ 1,200")).toMatchObject({ ok: true, stored: { number: 1200 } });
    expect(checkValue(def({ type: "NUMBER" }), "12.5%")).toMatchObject({ ok: true, stored: { number: 12.5 } });
    expect(checkValue(def({ type: "NUMBER" }), 0)).toMatchObject({ ok: true, stored: { number: 0 } });
  });
});

describe("MULTI_SELECT refuses a newly added archived option, like SELECT (QA logic #11)", () => {
  const multi = def({ type: "MULTI_SELECT", options });
  it("an archived option can't be added", () => {
    expect(checkValue(multi, [11, 12])).toEqual({ ok: false, message: "“Old” is archived; choose another option." });
  });
  it("one the task already had may stay", () => {
    expect(checkValue(multi, [11, 12], [12])).toMatchObject({ ok: true, stored: { ids: [11, 12] } });
  });
});

describe("a start date is a real calendar day (QA logic #8)", () => {
  it("accepts real days only", () => {
    expect(realDay("2026-02-28")).toBe("2026-02-28");
    expect(realDay("2028-02-29")).toBe("2028-02-29");
    expect(realDay("2026-02-31")).toBeNull();
    expect(realDay("2026-13-01")).toBeNull();
    expect(realDay("26-02-01")).toBeNull();
  });
});
