import { describe, expect, it } from "vitest";
import { buildTemplate, clampWidth, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, parseStoredWidths } from "@/features/work/useColumnWidths";

describe("column widths", () => {
  it("clamps a width to 60..800 whole pixels", () => {
    expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(5000)).toBe(MAX_COLUMN_WIDTH);
    expect(clampWidth(123.6)).toBe(124);
    expect(clampWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH);
  });

  it("builds the template: defaults, a flexible column until resized, then fixed", () => {
    const defaults = [
      { key: "name", width: 260, flex: true },
      { key: "due", width: 130 },
      { key: "f7", width: 150 },
    ];
    expect(buildTemplate(defaults, {})).toBe("minmax(260px,1fr) 130px 150px");
    expect(buildTemplate(defaults, { name: 400, f7: 2000 })).toBe("400px 130px 800px");
    expect(buildTemplate(defaults, { other: 90 })).toBe("minmax(260px,1fr) 130px 150px");
  });

  it("reads saved widths safely", () => {
    expect(parseStoredWidths(null)).toEqual({});
    expect(parseStoredWidths("not json")).toEqual({});
    expect(parseStoredWidths("[1,2]")).toEqual({});
    expect(parseStoredWidths('{"name":300,"due":"x","tags":10}')).toEqual({ name: 300, tags: 60 });
  });
});
