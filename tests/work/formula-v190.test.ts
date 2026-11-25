import { describe, expect, it } from "vitest";
import { analyseFormula, dayNumber, evaluateFormula, FORMULA_FUNCTIONS, FORMULA_PRESETS, formulaBuiltins, formulaFromText, formulaText, indiaMoment, momentNumber, parseFormula, type Builtin, type FxField } from "@/server/work/formula";
import { DEFAULT_CONFIG, formulaCell, type FieldDef, type FormulaTask, type StoredValue } from "@/server/work/custom-fields";

// v1.90.0 (D-430, owner: "Add TODAY() and NOW() in the formulas functions"):
// the owner typed "[NFD] − TODAY" and got an error.
const d = (day: string) => dayNumber(day);
const NOW = "2026-11-25T18:00:00"; // 6 pm India time
const run = (text: string, values: Record<number, number | null> = {}, dates: Partial<Record<Builtin, string>> = {}) => {
  const parsed = parseFormula(text);
  if (!parsed.ok) return parsed.message;
  const result = evaluateFormula(parsed.node, { field: (id) => ({ ok: true, value: values[id] ?? null }), builtin: (name) => (dates[name] ? (name === "now" ? momentNumber(dates[name]!) : d(dates[name]!)) : null) });
  return result.ok ? result.value : result.error;
};
const fields = new Map<number, FxField>([
  [3, { id: 3, name: "NFD", kind: "DATE" }],
  [1, { id: 1, name: "Cost", kind: "NUMBER" }],
]);
const typed = (text: string) => {
  const stored = formulaFromText(text, [...fields.values()]);
  if (!stored.ok) return stored.message;
  const result = analyseFormula(stored.expr, fields);
  return result.ok ? result.type : result.message;
};

describe("TODAY() and NOW()", () => {
  it("the owner's formula reads: [NFD] − TODAY, any case, with or without brackets, and with a typed dash", () => {
    for (const text of ["[NFD] − TODAY", "[NFD] − TODAY()", "[NFD] - today", "[NFD] – Today()", "[NFD] − [Today]"]) expect(typed(text)).toBe("number");
    expect(run("{f3} - TODAY", { 3: d("2026-11-30") }, { today: "2026-11-25" })).toBe(5);
    expect(run("{f3} - today()", { 3: d("2026-11-20") }, { today: "2026-11-25" })).toBe(-5);
  });
  it("TODAY() is the same input as [Today] (one input, stored the same way)", () => {
    const a = parseFormula("DAYS(TODAY(), {f3}) + DAYS({today}, {f3})");
    expect(a.ok && formulaBuiltins(a.node)).toEqual(["today"]);
    const analysed = analyseFormula("DAYS(TODAY(), {f3}) + DAYS({today}, {f3})", fields);
    expect(analysed.ok && analysed.inputs).toBe(2); // NFD + today
  });
  it("NOW() is the date-time: a date minus NOW() gives days with decimals; ROUND tidies it", () => {
    expect(run("{f3} - NOW()", { 3: d("2026-11-27") }, { now: NOW })).toBe(1.25);
    expect(run("ROUND({f3} - now, 1)", { 3: d("2026-11-26") }, { now: NOW })).toBe(0.3);
    expect(typed("[NFD] − NOW()")).toBe("number");
    expect(typed("NOW()")).toBe("date");
    expect(typed("[Now] + 1")).toBe("date");
  });
  it("NOW and TODAY count one input each and are told apart", () => {
    const result = analyseFormula("DAYS(TODAY(), NOW())", fields);
    expect(result.ok && [result.inputs, result.builtins]).toEqual([2, ["today", "now"]]);
  });
  it("take no values and refuse them", () => {
    expect(run("TODAY(1)")).toBe("TODAY takes 0 values: TODAY().");
    expect(run("NOW(1, 2)")).toBe("NOW takes 0 values: NOW().");
  });
  it("read back as [Today] and [Now]", () => {
    const stored = formulaFromText("[NFD] − NOW() + [now] - TODAY", [...fields.values()]);
    expect(stored.ok && stored.expr).toBe("{f3} − NOW() + {now} - TODAY");
    expect(formulaText("{f3} - {now}", new Map([[3, "NFD"]]))).toBe("[NFD] - [Now]");
  });
  it("are in the Functions list with an example, and NFD Delay uses TODAY() (same result)", () => {
    for (const name of ["TODAY", "NOW"]) expect(FORMULA_FUNCTIONS.find((item) => item.name === name)).toMatchObject({ min: 0, max: 0, signature: `${name}()` });
    expect(FORMULA_PRESETS.find((item) => item.key === "nfd")!.text).toBe("DAYS(TODAY(), [NFD])");
    expect(run("DAYS(TODAY(), {f3})", { 3: d("2026-11-20") }, { today: "2026-11-23" })).toBe(run("DAYS({today}, {f3})", { 3: d("2026-11-20") }, { today: "2026-11-23" }));
  });
  it("NOW reads India time", () => {
    expect(indiaMoment(new Date("2026-11-25T20:00:00Z"))).toBe("2026-11-26T01:30:00");
    expect(momentNumber("2026-11-26T12:00:00")).toBe(d("2026-11-26") + 0.5);
    expect(momentNumber("nonsense")).toBeNull();
  });
});

const def = (over: Partial<FieldDef>): FieldDef => ({ id: 1, name: "Field", type: "NUMBER", config: DEFAULT_CONFIG, options: [], ...over });
const stored = (over: Partial<StoredValue>): StoredValue => ({ text: null, number: null, date: null, time: null, optionId: null, ids: null, ...over });
const formula = (id: number, name: string, text: string, decimals = 0) => def({ id, name, type: "FORMULA", config: { ...DEFAULT_CONFIG, formula: text, decimals } });

describe("TODAY() and NOW() on a task", () => {
  const defs = new Map<number, FieldDef>([
    [3, def({ id: 3, name: "NFD", type: "DATE" })],
    [30, formula(30, "Left", "{f3} - TODAY()")],
    [31, formula(31, "Hours left", "ROUND(({f3} - NOW()) * 24, 0)")],
    [32, formula(32, "Tomorrow", "DATEADD(NOW(), 1)")],
    [33, formula(33, "Work left", "WORKDAYS(NOW(), {f3})")],
  ]);
  const values = new Map<number, StoredValue | null>([[3, stored({ date: "2026-11-27" })]]);
  const task: FormulaTask = { dates: { today: "2026-11-25", now: NOW } };
  const cell = (id: number) => formulaCell(defs.get(id)!, defs, values, task);
  it("work out on reading", () => {
    expect(cell(30).text).toBe("2");
    expect(cell(31).text).toBe("30");
    expect(cell(32).text).toBe("26 Nov 2026"); // a date-time result shows as its date
    expect(cell(33).text).toBe("3"); // whole days, both counted
  });
});
