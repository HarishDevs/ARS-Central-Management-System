import { describe, expect, it } from "vitest";
import {
  analyseFormula,
  dayNumber,
  dayOf,
  evaluateFormula,
  FORMULA_FUNCTIONS,
  FORMULA_PRESETS,
  formulaBuiltins,
  formulaFields,
  formulaFromText,
  formulaText,
  parseFormula,
  presetText,
  type Builtin,
  type FxField,
} from "@/server/work/formula";
import { DEFAULT_CONFIG, formulaCell, matchFieldFilter, type FieldDef, type FormulaTask, type StoredValue } from "@/server/work/custom-fields";
import { conditionMatches, type TaskFacts } from "@/server/work/automation-rules";

// v1.88.0 (D-418, spec FORMULA_FIELDS): functions, the task's own dates,
// types, limits, presets and v1.64 formulas still working.
const MON = "2026-11-23"; // a Monday
const FRI = "2026-11-27";
const d = (day: string) => dayNumber(day);
const run = (text: string, values: Record<number, number | null> = {}, dates: Partial<Record<Builtin, string>> = {}) => {
  const parsed = parseFormula(text);
  if (!parsed.ok) return parsed.message;
  const result = evaluateFormula(parsed.node, { field: (id) => ({ ok: true, value: values[id] ?? null }), builtin: (name) => (dates[name] ? d(dates[name]!) : null) });
  return result.ok ? result.value : result.error;
};
// Fields for the type and limit checks: 1 number, 2 date, 3 date, 4 timer, 5 text.
const fx = (extra: FxField[] = []) =>
  new Map<number, FxField>(
    [
      { id: 1, name: "Cost", kind: "NUMBER" },
      { id: 2, name: "Review", kind: "DATE" },
      { id: 3, name: "Revised Target", kind: "DATE" },
      { id: 4, name: "Time", kind: "TIMER" },
      { id: 5, name: "Notes", kind: "TEXT" },
      ...extra,
    ].map((field) => [field.id, field]),
  );
const check = (expr: string, fields = fx(), self: number | null = null) => {
  const result = analyseFormula(expr, fields, self);
  return result.ok ? result.type : result.message;
};

describe("functions (case-insensitive)", () => {
  it("ADD, SUBTRACT, MULTIPLY, DIVIDE do what the signs do", () => {
    expect(run("ADD(3, 5)")).toBe(8);
    expect(run("add(3, 5) + 8")).toBe(16);
    expect(run("Subtract(13, 5) - 1")).toBe(7);
    expect(run("MULTIPLY(3, 5) * 2")).toBe(30);
    expect(run("DIVIDE(3, 4)")).toBe(0.75);
    expect(run("DIVIDE({f1}, 0)", { 1: 3 })).toBe("DIV_ZERO");
  });
  it("DATEADD and DATESUBTRACT move a date by whole days", () => {
    expect(run("DATEADD({due}, 5)", {}, { due: MON })).toBe(d("2026-11-28"));
    expect(run("DATESUBTRACT({due}, 2)", {}, { due: MON })).toBe(d("2026-11-21"));
    expect(run("dateadd({due}, 1.6)", {}, { due: MON })).toBe(d("2026-11-25"));
  });
  it("DAYS is to minus from; WORKDAYS counts working days, both ends, on the calendar", () => {
    expect(run("DAYS({start}, {due})", {}, { start: MON, due: FRI })).toBe(4); // AC-FX-03
    expect(run("DAYS({due}, {start})", {}, { start: MON, due: FRI })).toBe(-4);
    const node = (parseFormula("WORKDAYS({start}, {due})") as { ok: true; node: never }).node;
    const env = (start: string, due: string, calendar?: { offDays: Set<string>; workingWeekdays: Set<number> }) => evaluateFormula(node, { field: () => ({ ok: true, value: null }), builtin: (name) => d(name === "start" ? start : due), calendar });
    const week = { offDays: new Set(["2026-11-25"]), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) }; // Mon–Sat, a holiday on Wednesday
    expect(env(MON, FRI, week)).toEqual({ ok: true, value: 4 });
    expect(env(MON, "2026-11-30", week)).toEqual({ ok: true, value: 6 }); // Sunday skipped, next Monday counted
    expect(env(FRI, MON, week)).toEqual({ ok: true, value: -4 });
    expect(env(MON, MON)).toEqual({ ok: true, value: 1 });
  });
  it("IF with every comparison; only the chosen branch is worked out", () => {
    expect(run("IF({f1} > 100, 1, 0)", { 1: 150 })).toBe(1);
    expect(run("IF({f1} < 100, 1, 0)", { 1: 150 })).toBe(0);
    expect(run("IF({f1} >= 150, 1, 0)", { 1: 150 })).toBe(1);
    expect(run("IF({f1} <= 149, 1, 0)", { 1: 150 })).toBe(0);
    expect(run("IF({f1} = 150, 1, 0)", { 1: 150 })).toBe(1);
    expect(run("IF({f1} <> 150, 1, 0)", { 1: 150 })).toBe(0);
    expect(run("if({f1} != 1, 2, 3)", { 1: 150 })).toBe(2);
    expect(run("IF({f1} > 0, 1, 1 / 0)", { 1: 5 })).toBe(1);
    expect(run("IF({f1} > 0, 1, 0)")).toBeNull();
  });
  it("ROUND, MIN, MAX, ABS, COALESCE", () => {
    expect(run("ROUND(10 / 3, 2)")).toBe(3.33);
    expect(run("ROUND(2.5)")).toBe(3);
    expect(run("ROUND(-2.5)")).toBe(-3);
    expect(run("ROUND(1.005, 2)")).toBe(1.01);
    expect(run("MIN(4, 2, 9)")).toBe(2);
    expect(run("MAX(4, 2, 9)")).toBe(9);
    expect(run("MIN({f1}, 2)")).toBeNull();
    expect(run("ABS(-7)")).toBe(7);
    expect(run("COALESCE({f1}, 0)")).toBe(0);
    expect(run("COALESCE({f1}, {f2}, 5)", { 2: 4 })).toBe(4);
    expect(run("DAYS({start}, {due})")).toBeNull(); // AC-FX-03: missing dates leave it empty
    expect(run("COALESCE(DAYS({start}, {due}), 0)")).toBe(0); // … or 0 with COALESCE
  });
  it("lists a help card for each function: description, signature, one example", () => {
    expect(FORMULA_FUNCTIONS.map((item) => item.name)).toEqual(["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "DATEADD", "DATESUBTRACT", "ROLLUP", "DAYS", "WORKDAYS", "IF", "ROUND", "MIN", "MAX", "ABS", "COALESCE", "TODAY", "NOW"]); // + TODAY, NOW in v1.90 (D-430)
    for (const item of FORMULA_FUNCTIONS) {
      expect(item.help.length).toBeGreaterThan(10);
      expect(item.signature.startsWith(`${item.name}(`)).toBe(true);
      expect(item.example).toContain(`${item.name}(`);
    }
  });
});

describe("reading formulas", () => {
  it("argument counts and unknown names get clear messages", () => {
    expect(run("DAYS({due})")).toMatch(/DAYS takes 2 values/);
    expect(run("ROUND(1, 2, 3)")).toMatch(/ROUND takes 1 to 2 values/);
    expect(run("FOO(1)")).toMatch(/can't use “FOO”/);
    expect(run("DAYS {due}")).toMatch(/Write DAYS with brackets/);
    expect(run("DAYS({start} {due})")).toMatch(/Separate DAYS's values with commas/);
    expect(run("1, 2")).toMatch(/comma is out of place/);
    expect(run("1 < 2 < 3")).toMatch(/two values at a time/);
    expect(run("[Cost] + 1")).toMatch(/brackets/);
  });
  it("built-ins and TODAY()", () => {
    const parsed = parseFormula("DAYS(TODAY(), {due}) + {f3} - {start}");
    expect(parsed.ok && formulaBuiltins(parsed.node)).toEqual(["today", "due", "start"]);
    expect(parsed.ok && formulaFields(parsed.node)).toEqual([3]);
  });
  it("typed text ↔ stored tokens; a project field wins over a task date of the same name", () => {
    const fields = [
      { id: 12, name: "Cost/Unit" },
      { id: 13, name: "NFD" },
    ];
    expect(formulaFromText("DAYS([Today], [nfd]) + [Cost/Unit] - [due date] + [Start]", fields)).toEqual({ ok: true, expr: "DAYS({today}, {f13}) + {f12} - {due} + {start}" });
    expect(formulaFromText("[Due date]", [{ id: 9, name: "Due date" }])).toEqual({ ok: true, expr: "{f9}" });
    const missing = formulaFromText("[Nope] + 1", fields);
    expect(!missing.ok && missing.message).toMatch(/“Nope”/);
    expect(formulaFromText("1+".repeat(260), fields).ok).toBe(false);
    expect(formulaText("DAYS({today}, {f13}) * {f12} / 2", new Map([[13, "NFD"], [12, "Cost/Unit"]]))).toBe("DAYS([Today], [NFD]) × [Cost/Unit] ÷ 2");
  });
});

describe("types", () => {
  it("a formula gives a number or a date; date − date stays days (v1.64)", () => {
    expect(check("{f3} - {f2}")).toBe("number");
    expect(check("DATEADD({f2}, 3)")).toBe("date");
    expect(check("{f2} + 3")).toBe("date");
    expect(check("{f2} - 3")).toBe("date");
    expect(check("IF({f1} > 5, {f2}, {f3})")).toBe("date");
    expect(check("MIN({f2}, {due})")).toBe("date");
    expect(check("COALESCE({f1}, 0) * 2")).toBe("number");
    expect(check("ROLLUP({f4})")).toBe("number");
  });
  it("wrong types get specific messages", () => {
    expect(check("{f2} + {f3}")).toMatch(/Two dates can't be added/);
    expect(check("{f2} * 2")).toMatch(/can't be multiplied/);
    expect(check("{f2} / 2")).toMatch(/can't be divided/);
    expect(check("3 - {f2}")).toMatch(/DATESUBTRACT/);
    expect(check("-{f2}")).toMatch(/minus sign needs a number/);
    expect(check("DAYS({f1}, {due})")).toMatch(/DAYS's first value needs a date, not a number/);
    expect(check("DATEADD({due}, {f2})")).toMatch(/needs a number, not a date/);
    expect(check("IF({f1}, 1, 0)")).toMatch(/IF starts with a comparison/);
    expect(check("IF({f1} > 1, 1, {due})")).toMatch(/both be numbers or both be dates/);
    expect(check("{f1} > 1")).toMatch(/comparison only works as the first part of IF/);
    expect(check("{f1} > {due}")).toMatch(/two numbers or two dates/);
    expect(check("MAX({f1}, {due})")).toMatch(/all be numbers or all be dates/);
    expect(check("ROLLUP({f2})")).toMatch(/ROLLUP adds up numbers/);
    expect(check("ROLLUP({f1} + 1)")).toMatch(/ROLLUP takes one number field/);
    expect(check("{f5} + 1")).toMatch(/“Notes” can't be used/);
    expect(check("{f99} + 1")).toMatch(/isn't in this project/);
  });
});

describe("limits (AC-FX-05)", () => {
  it("at most 10 inputs, counting fields and task dates once each", () => {
    const many = new Map([...fx()].concat(Array.from({ length: 12 }, (_, i) => [100 + i, { id: 100 + i, name: `N${i}`, kind: "NUMBER" }] as [number, FxField])));
    expect(check(Array.from({ length: 10 }, (_, i) => `{f${100 + i}}`).join(" + "), many)).toBe("number");
    expect(check(`${Array.from({ length: 9 }, (_, i) => `{f${100 + i}}`).join(" + ")} + {f100} + DAYS({today}, {today})`, many)).toBe("number");
    expect(check(Array.from({ length: 11 }, (_, i) => `{f${100 + i}}`).join(" + "), many)).toMatch(/at most 10 inputs .* uses 11/);
  });
  it("formulas on formulas at most 2 layers; loops refused", () => {
    const chain = fx([
      { id: 10, name: "A", kind: "FORMULA", formula: "{f1} * 2" },
      { id: 11, name: "B", kind: "FORMULA", formula: "{f10} + 1" },
      { id: 12, name: "C", kind: "FORMULA", formula: "{f11} + 1" },
      { id: 13, name: "Self", kind: "FORMULA", formula: "{f14}" },
      { id: 14, name: "Other", kind: "FORMULA", formula: "{f13}" },
    ]);
    const ok = analyseFormula("{f11} + 1", chain);
    expect(ok.ok && ok.layers).toBe(2);
    expect(check("{f12} + 1", chain)).toMatch(/at most 2 layers deep; this one would be 3/);
    expect(check("{f14} + 1", chain, 13)).toMatch(/refer to itself through another formula/);
    expect(check("{f13} + 1", chain, 13)).toMatch(/can't use itself/);
  });
  it("500 characters as people read them", () => {
    const long = `${"123456789 + ".repeat(41)}12345`; // 497 characters
    expect(check(long)).toBe("number");
    expect(check(`${long} + 10`)).toMatch(/500 characters or fewer/);
  });
});

// ---- on tasks ---------------------------------------------------------------------------------
const def = (over: Partial<FieldDef>): FieldDef => ({ id: 1, name: "Field", type: "NUMBER", config: DEFAULT_CONFIG, options: [], ...over });
const stored = (over: Partial<StoredValue>): StoredValue => ({ text: null, number: null, date: null, time: null, optionId: null, ids: null, ...over });
const formula = (id: number, name: string, text: string, decimals = 0) => def({ id, name, type: "FORMULA", config: { ...DEFAULT_CONFIG, formula: text, decimals } });

describe("formula cells", () => {
  const fields = new Map<number, FieldDef>([
    [1, def({ id: 1, name: "Hours", type: "NUMBER" })],
    [2, def({ id: 2, name: "Revised Target", type: "DATE" })],
    [3, def({ id: 3, name: "NFD", type: "DATE" })],
    [12, def({ id: 12, name: "Old A", type: "NUMBER" })],
    [13, def({ id: 13, name: "Old B", type: "NUMBER" })],
    [20, formula(20, "Legacy", "{f12} - {f13}")],
    [21, formula(21, "TAT", "DAYS({start}, {due})")],
    [22, formula(22, "Delay", "DAYS({start}, {f2})")],
    [23, formula(23, "NFD Delay", "DAYS({today}, {f3})")],
    [24, formula(24, "Delay Days", "DAYS({due}, {completed}) - 1")],
    [25, formula(25, "Total hours", "ROLLUP({f1}) + {f1}")],
    [26, formula(26, "Follow-up", "DATEADD({due}, 7)", 2)],
    [27, formula(27, "Plan days", "ROLLUP({f21})")],
  ]);
  const values = new Map<number, StoredValue | null>([
    [1, stored({ number: 2 })],
    [2, stored({ date: "2026-12-03" })],
    [3, stored({ date: "2026-11-20" })],
    [12, stored({ number: 50 })],
    [13, stored({ number: 8 })],
  ]);
  const task: FormulaTask = {
    dates: { start: MON, due: FRI, created: "2026-11-20", completed: "2026-12-01", today: "2026-11-23" },
    subtasks: [
      { stored: new Map([[1, stored({ number: 3 })]]), dates: { start: MON, due: "2026-11-24" } },
      { stored: new Map([[1, stored({ number: 4.5 })]]), dates: { start: "2026-11-25", due: FRI } },
      { stored: new Map(), dates: {} },
    ],
  };
  const cell = (id: number, t: FormulaTask = task) => formulaCell(fields.get(id)!, fields, values, t);
  it("a saved v1.64 formula reads and works as before", () => {
    expect(cell(20, {}).text).toBe("42");
  });
  it("the owner's four formulas give the same days as Asana's (AC-FX-08)", () => {
    // Asana: ([Due] − [Start]) / 1440 = 4; ([Revised Target] − [Start]) / 1440 = 10;
    // ([NFD] − [Today]) / 1440 = −3; (([Completed on] − [Due]) − 1440) / 1440 = 3.
    expect(cell(21).text).toBe("4");
    expect(cell(22).text).toBe("10");
    expect(cell(23).text).toBe("-3");
    expect(cell(24).text).toBe("3");
  });
  it("Today is the day it is read (AC-FX-04)", () => {
    expect(cell(23, { ...task, dates: { ...task.dates, today: "2026-11-24" } }).text).toBe("-4");
  });
  it("ROLLUP sums first-level subtasks; the task's own value only when added (AC-FX-07)", () => {
    expect(cell(25).text).toBe("10"); // 3 + 4.5 + 2 = 9.5, shown with 0 decimals
    expect(formulaCell(formula(25, "Total hours", "ROLLUP({f1}) + {f1}", 1), fields, values, task).text).toBe("9.5");
    expect(formulaCell(formula(28, "Sub only", "ROLLUP({f1})", 1), new Map([...fields, [28, formula(28, "Sub only", "ROLLUP({f1})", 1)]]), values, task).text).toBe("7.5");
    expect(cell(27).text).toBe("3"); // TAT of each subtask: 1 + 2 (the third has no dates)
    expect(cell(25, { ...task, subtasks: [] }).text).toBe(""); // no subtask values: empty (COALESCE for 0)
  });
  it("a formula that gives a date shows as a date and sorts as one; formatting doesn't apply", () => {
    expect(cell(26)).toEqual({ text: "4 Dec 2026", sort: "2026-12-04", edit: "" });
    expect(matchFieldFilter("FORMULA", cell(26), { fieldId: 26, op: "gt", value: "2026-12-01" }, 1)).toBe(true);
    expect(matchFieldFilter("FORMULA", cell(26), { fieldId: 26, op: "lt", value: "2026-12-01" }, 1)).toBe(false);
    expect(matchFieldFilter("FORMULA", cell(21), { fieldId: 21, op: "gt", value: "3" }, 1)).toBe(true);
  });
  it("errors show on the cell, not as a crash", () => {
    const broken = new Map([...fields, [30, formula(30, "Bad", "DAYS({f1}, {due})")], [31, formula(31, "Gone", "{f999} + 1")]]);
    expect(formulaCell(broken.get(30)!, broken, values, task)).toMatchObject({ text: "Formula needs fixing", error: "INVALID" });
    expect(formulaCell(broken.get(31)!, broken, values, task)).toMatchObject({ error: "MISSING" });
  });
  it("automation conditions compare a date formula as a date", () => {
    const facts = (fact: { number: number | null; date: string | null }): TaskFacts => ({ sectionId: null, assigneeId: 1, priority: "NORMAL", dueDay: null, status: "OPEN", title: "T", fields: new Map([[26, { type: "FORMULA", text: null, optionId: null, ids: null, ...fact }]]) });
    expect(conditionMatches({ subject: "FIELD", fieldId: 26, op: "GT", value: "2026-12-01" }, facts({ number: null, date: "2026-12-04" }), MON)).toBe(true);
    expect(conditionMatches({ subject: "FIELD", fieldId: 26, op: "GT", value: 3 }, facts({ number: 4, date: null }), MON)).toBe(true);
  });
});

describe("presets", () => {
  it("are the owner's four Asana fields, end minus start (positive = later)", () => {
    expect(FORMULA_PRESETS.map((item) => [item.name, item.text])).toEqual([
      ["TAT", "DAYS([Start date], [Due date])"],
      ["Delay", "DAYS([Start date], [Revised Target])"],
      ["NFD Delay", "DAYS(TODAY(), [NFD])"], // v1.90 (D-430): TODAY() is the same input as [Today]
      ["Delay Days", "DAYS([Due date], [Completed on]) - 1"],
    ]);
  });
  it("use the project's date field, or the one picked, and read right", () => {
    const delay = FORMULA_PRESETS.find((item) => item.key === "delay")!;
    expect(presetText(delay, "Target date")).toBe("DAYS([Start date], [Target date])");
    const fields = fx();
    for (const item of FORMULA_PRESETS) {
      const typed = formulaFromText(presetText(item, item.needs ? (item.needs === "NFD" ? "Review" : "revised target") : null), [...fields.values()]);
      expect(typed.ok).toBe(true);
      if (typed.ok) expect(analyseFormula(typed.expr, fields).ok).toBe(true);
    }
  });
});

describe("day numbers", () => {
  it("round-trip and refuse silly dates", () => {
    expect(dayOf(dayNumber("2026-11-23"))).toBe("2026-11-23");
    expect(dayOf(1e9)).toBeNull();
    expect(dayOf(1.5)).toBeNull();
  });
});
