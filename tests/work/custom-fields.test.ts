import { describe, expect, it } from "vitest";
import { evaluateFormula, formulaFields, formulaLoop, formulaText, parseFormula } from "@/server/work/formula";
import {
  checkValue,
  cleanIdPrefix,
  cleanOptions,
  DEFAULT_CONFIG,
  DEFAULT_FIELD_LIMITS,
  fieldGroups,
  formatNumber,
  formulaCell,
  idText,
  legacyText,
  matchFieldFilter,
  mayCustomise,
  mayEditDefinition,
  NOTIFY_TYPES,
  parseFieldConfig,
  parseFieldLimits,
  storedCell,
  timerText,
  type FieldDef,
  type StoredValue,
} from "@/server/work/custom-fields";
import { applyGrid, DEFAULT_GRID, type GridTask } from "@/server/work/grid";

// v1.64.0 (D-371, PM phase B part 1): custom field rules.
const def = (over: Partial<FieldDef>): FieldDef => ({ id: 1, name: "Field", type: "TEXT", config: DEFAULT_CONFIG, options: [], ...over });
const stored = (over: Partial<StoredValue>): StoredValue => ({ text: null, number: null, date: null, time: null, optionId: null, ids: null, ...over });
const context = { people: new Map([[7, "Asha Rao"]]), tasks: new Map([[9, { taskNo: "TSK-1", title: "Linked" }]]) };

describe("formula parser and evaluator", () => {
  const run = (text: string, values: Record<number, number | null> = {}) => {
    const parsed = parseFormula(text);
    if (!parsed.ok) return parsed.message;
    const result = evaluateFormula(parsed.node, (id) => ({ ok: true, value: values[id] ?? null }));
    return result.ok ? result.value : result.error;
  };
  it("follows precedence, brackets, unary minus and the × ÷ − signs", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("-2 + 5")).toBe(3);
    expect(run("10 ÷ 4 × 2 − 1")).toBe(4);
    expect(run("{f1} - {f2}", { 1: 100, 2: 30 })).toBe(70);
  });
  it("divide by zero is an error, an empty field leaves it empty", () => {
    expect(run("{f1} / {f2}", { 1: 5, 2: 0 })).toBe("DIV_ZERO");
    expect(run("{f1} / {f2}", { 1: 5 })).toBeNull();
  });
  it("refuses anything that isn't arithmetic (no eval)", () => {
    expect(run("alert(1)")).toMatch(/can't use/);
    expect(run("1 +")).toMatch(/ends too early/);
    expect(run("(1 + 2")).toMatch(/isn't closed/);
    expect(run("1 2")).toMatch(/sign/);
    expect(run("")).toMatch(/Write a formula/);
    expect(run("{x1}")).toMatch(/isn't written/);
    expect(parseFormula("1+".repeat(300) + "1").ok).toBe(false);
  });
  it("lists the fields it uses, finds loops, reads back with names", () => {
    const parsed = parseFormula("{f1} + {f2} * {f1}");
    expect(parsed.ok && formulaFields(parsed.node)).toEqual([1, 2]);
    expect(formulaLoop(5, [6], new Map([[6, [5]]]))).toBe(true);
    expect(formulaLoop(5, [6], new Map([[6, [1]]]))).toBe(false);
    expect(formulaText("{f1} * {f2} / 2", new Map([[1, "Rate"], [2, "Hours"]]))).toBe("[Rate] × [Hours] ÷ 2");
  });
  it("formula cells use numbers, dates as days, and catch loops between formulas", () => {
    const fields = new Map<number, FieldDef>([
      [1, def({ id: 1, type: "NUMBER" })],
      [2, def({ id: 2, type: "DATE" })],
      [3, def({ id: 3, type: "DATE" })],
      [4, def({ id: 4, type: "FORMULA", config: { ...DEFAULT_CONFIG, formula: "{f3} - {f2}" } })],
      [5, def({ id: 5, type: "FORMULA", config: { ...DEFAULT_CONFIG, formula: "{f6} + 1" } })],
      [6, def({ id: 6, type: "FORMULA", config: { ...DEFAULT_CONFIG, formula: "{f5} + 1" } })],
      [7, def({ id: 7, type: "FORMULA", config: { ...DEFAULT_CONFIG, formula: "{f1} / 0", format: "currency", decimals: 2 } })],
    ]);
    const values = new Map([
      [1, stored({ number: 1234.5 })],
      [2, stored({ date: "2026-11-01" })],
      [3, stored({ date: "2026-11-11" })],
    ]);
    expect(formulaCell(fields.get(4)!, fields, values).text).toBe("10");
    expect(formulaCell(fields.get(5)!, fields, values).error).toBe("LOOP");
    expect(formulaCell(fields.get(7)!, fields, values).text).toBe("Can't divide by 0");
  });
});

describe("number, timer and ID formats", () => {
  it("formats with decimals and each format (AC-PROJC-07)", () => {
    expect(formatNumber(1234.5, { ...DEFAULT_CONFIG, decimals: 2 })).toBe("1,234.50");
    expect(formatNumber(1000, { ...DEFAULT_CONFIG, decimals: 1 })).toBe("1,000.0");
    expect(formatNumber(1234567, DEFAULT_CONFIG)).toBe("12,34,567");
    expect(formatNumber(12.5, { ...DEFAULT_CONFIG, format: "percent", decimals: 1 })).toBe("12.5%");
    expect(formatNumber(2500, { ...DEFAULT_CONFIG, format: "currency" })).toBe("₹2,500");
    expect(formatNumber(-5, { ...DEFAULT_CONFIG, format: "currency", symbol: "$" })).toBe("-$5");
    expect(formatNumber(3, { ...DEFAULT_CONFIG, format: "unit", unit: "MT" })).toBe("3 MT");
    expect(formatNumber(3, { ...DEFAULT_CONFIG, format: "unit", unit: "Rs", unitBefore: true })).toBe("Rs 3");
  });
  it("timers read h:mm; IDs PREFIX-n with a clean prefix", () => {
    expect(timerText(0)).toBe("0:00");
    expect(timerText(65 * 60 + 59)).toBe("1:05");
    expect(idText("PO", 12)).toBe("PO-12");
    expect(cleanIdPrefix(" po ")).toBe("PO");
    expect(cleanIdPrefix("1PO")).toBeNull();
    expect(cleanIdPrefix("TOOLONGPREFIX")).toBeNull();
  });
  it("settings are read safely", () => {
    expect(parseFieldConfig("{bad")).toEqual(DEFAULT_CONFIG);
    expect(parseFieldConfig({ decimals: 9 })).toEqual(DEFAULT_CONFIG);
    expect(parseFieldConfig({ decimals: 2 }).decimals).toBe(2);
  });
});

describe("values by type", () => {
  const select = def({ type: "SELECT", name: "Stage", options: [{ id: 11, name: "Open", color: 1, archived: false }, { id: 12, name: "Old", color: 2, archived: true }] });
  it("checks each type and clears with empty", () => {
    expect(checkValue(def({ type: "TEXT" }), "x".repeat(501)).ok).toBe(false);
    expect(checkValue(def({ type: "TEXT" }), "  ").ok && checkValue(def({ type: "TEXT" }), "  ")).toEqual({ ok: true, stored: null });
    expect(checkValue(def({ type: "NUMBER" }), "₹ 1,200.5")).toEqual({ ok: true, stored: stored({ number: 1200.5 }) });
    expect(checkValue(def({ type: "NUMBER" }), "abc").ok).toBe(false);
    expect(checkValue(select, 11)).toEqual({ ok: true, stored: stored({ optionId: 11 }) });
    expect(checkValue(select, "Open")).toEqual({ ok: true, stored: stored({ optionId: 11 }) });
    expect(checkValue(select, 12).ok).toBe(false); // archived
    expect(checkValue(def({ type: "MULTI_SELECT", options: select.options }), [11, 99]).ok).toBe(false);
    expect(checkValue(def({ type: "DATE" }), "2026-02-30").ok).toBe(false);
    expect(checkValue(def({ type: "DATE" }), "2026-02-03T10:30")).toEqual({ ok: true, stored: stored({ date: "2026-02-03", time: null }) });
    expect(checkValue(def({ type: "DATE", config: { ...DEFAULT_CONFIG, withTime: true } }), "2026-02-03T10:30")).toEqual({ ok: true, stored: stored({ date: "2026-02-03", time: "10:30" }) });
    expect(checkValue(def({ type: "PEOPLE" }), Array.from({ length: 21 }, (_, i) => i + 1)).ok).toBe(false);
    for (const type of ["FORMULA", "ID", "LOOKUP", "TIMER"] as const) expect(checkValue(def({ type }), "1").ok).toBe(false);
  });
  it("cells show and sort by type; the old column gets plain text", () => {
    expect(storedCell(select, stored({ optionId: 11 }), context)).toMatchObject({ text: "Open", sort: 0, optionIds: [11] });
    expect(storedCell(def({ type: "PEOPLE" }), stored({ ids: [7, 8] }), context).text).toBe("Asha Rao, Former user");
    expect(storedCell(def({ type: "REFERENCE" }), stored({ ids: [9, 10] }), context).text).toBe("TSK-1 Linked, 1 task you can't see");
    expect(storedCell(def({ type: "DATE", config: { ...DEFAULT_CONFIG, withTime: true } }), stored({ date: "2026-11-05", time: "09:15" }), context).text).toBe("5 Nov 2026, 09:15");
    expect(legacyText(def({ type: "MULTI_SELECT", options: select.options }), stored({ ids: [11, 12] }))).toBe("Open, Old");
    expect(legacyText(def({ type: "TIMER" }), stored({ number: 3600 }))).toBe("1:00");
  });
  it("notify is offered only for select, multi-select, date, people and reference (BR-PROJ-073)", () => {
    expect([...NOTIFY_TYPES].sort()).toEqual(["DATE", "MULTI_SELECT", "PEOPLE", "REFERENCE", "SELECT"]);
  });
});

describe("filters and groups", () => {
  const stage = def({ type: "SELECT", name: "Stage", options: [{ id: 1, name: "A", color: 1, archived: false }, { id: 2, name: "B", color: 2, archived: false }] });
  it("matches by type", () => {
    const cell = storedCell(stage, stored({ optionId: 2 }), context);
    expect(matchFieldFilter("SELECT", cell, { fieldId: 1, op: "is", value: "2" }, 0)).toBe(true);
    expect(matchFieldFilter("SELECT", cell, { fieldId: 1, op: "isNot", value: "2" }, 0)).toBe(false);
    expect(matchFieldFilter("SELECT", undefined, { fieldId: 1, op: "empty", value: "" }, 0)).toBe(true);
    const number = storedCell(def({ type: "NUMBER" }), stored({ number: 50 }), context);
    expect(matchFieldFilter("NUMBER", number, { fieldId: 1, op: "gt", value: "40" }, 0)).toBe(true);
    expect(matchFieldFilter("NUMBER", number, { fieldId: 1, op: "lt", value: "40" }, 0)).toBe(false);
    const people = storedCell(def({ type: "PEOPLE" }), stored({ ids: [7] }), context);
    expect(matchFieldFilter("PEOPLE", people, { fieldId: 1, op: "is", value: "me" }, 7)).toBe(true);
    const text = storedCell(def({ type: "TEXT" }), stored({ text: "Raipur plant" }), context);
    expect(matchFieldFilter("TEXT", text, { fieldId: 1, op: "contains", value: "raipur" }, 0)).toBe(true);
  });
  it("groups by option order, and a task with no value under No <field>", () => {
    expect(fieldGroups(stage, storedCell(stage, stored({ optionId: 2 }), context), "2026-11-22")).toEqual([["B", 1]]);
    expect(fieldGroups(stage, undefined, "2026-11-22")).toEqual([["No Stage", 1e9]]);
  });
  it("the task table filters, sorts and groups by a field", () => {
    const task = (id: number): GridTask => ({ id, taskNo: `T${id}`, title: `Task ${id}`, status: "OPEN", priority: "NORMAL", assigneeId: 1, assigneeName: "A", createdBy: 1, createdByName: "A", dueAt: null, startsOn: null, createdAt: "2026-11-01T00:00:00Z", completedAt: null, likes: 0, comments: 0, subtasks: 0, isPeriodic: false, isMilestone: false, projects: [], tags: [], followers: [], sectionId: null, position: id, canEdit: true, canComplete: true });
    const view = { id: 1, name: "Stage", kind: "SELECT" as const, options: ["A", "B"], choices: stage.options };
    const values = { 1: { 1: storedCell(stage, stored({ optionId: 2 }), context) }, 2: { 1: storedCell(stage, stored({ optionId: 1 }), context) } };
    const grouped = applyGrid([task(1), task(2), task(3)], { ...DEFAULT_GRID, groupField: 1 }, { today: "2026-11-22", meId: 1, values, fields: [view] });
    expect(grouped.map((group) => [group.name, group.rows.map((row) => row.id)])).toEqual([["A", [2]], ["B", [1]], ["No Stage", [3]]]);
    const filtered = applyGrid([task(1), task(2), task(3)], { ...DEFAULT_GRID, fieldFilters: [{ fieldId: 1, op: "is", value: "2" }] }, { today: "2026-11-22", meId: 1, values, fields: [view] });
    expect(filtered[0]!.rows.map((row) => row.id)).toEqual([1]);
    const sorted = applyGrid([task(1), task(2), task(3)], { ...DEFAULT_GRID, sortField: 1 }, { today: "2026-11-22", meId: 1, values, fields: [view] });
    expect(sorted[0]!.rows.map((row) => row.id)).toEqual([2, 1, 3]);
  });
});

describe("limits and who may change fields", () => {
  it("limits default to 150 / 60 / 500 and are read safely", () => {
    expect(DEFAULT_FIELD_LIMITS).toEqual({ perProject: 150, perTask: 60, options: 500 });
    expect(parseFieldLimits('{"perProject":20}').perProject).toBe(20);
    expect(parseFieldLimits('{"perProject":0}')).toEqual(DEFAULT_FIELD_LIMITS);
    expect(parseFieldLimits("nonsense")).toEqual(DEFAULT_FIELD_LIMITS);
  });
  it("options: names cleaned, no repeats, within the limit", () => {
    expect(cleanOptions([{ name: " High ", color: 1 }, { name: "", color: 2 }], 5)).toMatchObject({ ok: true, options: [{ name: "High" }] });
    expect(cleanOptions([{ name: "A", color: 1 }, { name: "a", color: 2 }], 5).ok).toBe(false);
    expect(cleanOptions([{ name: "A", color: 1 }, { name: "B", color: 2 }, { name: "C", color: 3 }], 2).ok).toBe(false);
    expect(cleanOptions([{ name: "", color: 1 }], 5).ok).toBe(false);
  });
  it("customising: editors by default, owners only when the project says so; IT always", () => {
    expect(mayCustomise("EDITOR", "EDITOR", false)).toBe(true);
    expect(mayCustomise("EDITOR", "OWNER", false)).toBe(false);
    expect(mayCustomise("OWNER", "OWNER", false)).toBe(true);
    expect(mayCustomise("COMMENTER", "EDITOR", false)).toBe(false);
    expect(mayCustomise(null, "OWNER", true)).toBe(true);
  });
  it("a library field's definition: its creator and IT only", () => {
    expect(mayEditDefinition({ library: true, createdBy: 5 }, { id: 5, isAdmin: false }, false)).toBe(true);
    expect(mayEditDefinition({ library: true, createdBy: 5 }, { id: 6, isAdmin: false }, true)).toBe(false);
    expect(mayEditDefinition({ library: true, createdBy: 5 }, { id: 6, isAdmin: true }, false)).toBe(true);
    expect(mayEditDefinition({ library: false, createdBy: 5 }, { id: 6, isAdmin: false }, true)).toBe(true);
    expect(mayEditDefinition({ library: false, createdBy: 5 }, { id: 5, isAdmin: false }, false)).toBe(false);
  });
});
