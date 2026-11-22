import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type FieldDef } from "@/server/work/custom-fields";
import { shiftDays } from "@/server/work/more-rules";
import {
  allTasks,
  applyChoice,
  countTasks,
  DEFAULT_DUPLICATE,
  fromPortable,
  legacyView,
  offsetLabel,
  parseTemplateBody,
  readDuplicateChoice,
  readLegacyTemplate,
  remapRefs,
  templateSummary,
  templateV2Schema,
  toPortable,
  type IdMaps,
  type TemplateV2,
} from "@/server/work/template-rules";
import { guessMapping, matchPerson, parseDay, parsePriority, planImport, IMPORT_MAX_ROWS, type Target } from "@/server/work/import-rules";
import { buildCalendar, escapeText, foldLine } from "@/server/work/ical";

// v1.70.0 (D-383, PM phase E part 1): templates (save/instantiate shape and
// date offsets, references), duplicate choices, import parsing and mapping,
// and the iCalendar output.
const select: FieldDef = { id: 11, name: "Stage", type: "SELECT", config: DEFAULT_CONFIG, options: [{ id: 101, name: "Draft", color: 1, archived: false }, { id: 102, name: "Final", color: 2, archived: false }] };
const multi: FieldDef = { id: 12, name: "Plants", type: "MULTI_SELECT", config: DEFAULT_CONFIG, options: [{ id: 201, name: "Raipur", color: 1, archived: false }, { id: 202, name: "Durg", color: 2, archived: false }] };
const date: FieldDef = { id: 13, name: "Review", type: "DATE", config: { ...DEFAULT_CONFIG, withTime: true }, options: [] };
const people: FieldDef = { id: 14, name: "Reviewers", type: "PEOPLE", config: DEFAULT_CONFIG, options: [] };
const text: FieldDef = { id: 15, name: "Vendor", type: "TEXT", config: DEFAULT_CONFIG, options: [] };
const number: FieldDef = { id: 16, name: "Amount", type: "NUMBER", config: DEFAULT_CONFIG, options: [] };
const empty = { text: null, number: null, date: null, time: null, optionId: null, ids: null };

const sample = (): TemplateV2 =>
  templateV2Schema.parse({
    version: 2,
    sections: [{ ref: 1, name: "Plan" }, { ref: 2, name: "Do" }],
    fields: [{ ref: 11, name: "Stage", type: "SELECT", options: [{ ref: 101, name: "Draft", color: 1 }, { ref: 102, name: "Final", color: 2 }] }],
    placeholders: [{ key: "p1", label: "Sita Staff", userId: 7 }],
    tasks: [
      { key: "t1", title: "Kick-off", description: null, priority: "NORMAL", section: 0, dueOffset: 0, startOffset: null, isMilestone: true, tags: [], assignee: "p1", values: { "11": { option: "Draft" } }, subtasks: [{ key: "t2", title: "Agenda", description: null, priority: "NORMAL", section: 0, dueOffset: -1, startOffset: null, isMilestone: false, tags: [], assignee: null, values: {}, subtasks: [] }] },
      { key: "t3", title: "Build", description: "Do it", priority: "HIGH", section: 1, dueOffset: 9, startOffset: 2, isMilestone: false, tags: ["build"], assignee: "p1", values: {}, subtasks: [] },
    ],
    dependencies: [{ predecessor: "t1", successor: "t3", type: "SS", lag: 0 }],
    tabs: [{ type: "BOARD", name: "Board", config: { groupField: 11, fieldFilters: [{ fieldId: 11, op: "is", value: "101" }] } }],
    widgets: [{ kind: "TEXT", title: "Notes", body: "Hello" }],
    automations: [{ name: "Move", definition: { trigger: { type: "MOVED_TO_SECTION", sectionId: 2 }, steps: [], paths: [], otherwise: [] } }],
    forms: [{ ref: 5, name: "Intake", draft: { fields: [], mappings: {} }, settings: { sectionId: 1 } }],
  });

describe("template shape (D-383)", () => {
  it("reads a version 2 template and counts what it holds", () => {
    const body = parseTemplateBody(JSON.stringify(sample()))!;
    expect(countTasks(body.tasks)).toBe(3);
    expect(allTasks(body.tasks).map((task) => task.key)).toEqual(["t1", "t2", "t3"]);
    expect(templateSummary(body)).toMatchObject({ tasks: 3, sections: 2, fields: 1, dependencies: 1, tabs: 1, widgets: 1, automations: 1, forms: 1, placeholders: 1, days: 9 });
  });

  it("upgrades a D-218 template: fields by name, and every task gets a due date (mandatory)", () => {
    const v1 = { sections: ["A"], fields: [{ name: "Plant", kind: "SELECT", options: ["X", "Y"] }], tasks: [{ title: "No date", description: null, priority: "NORMAL", section: 0, dueOffset: null, startOffset: 3, isMilestone: false, tags: [], fields: { Plant: "Y" }, subtasks: [] }] };
    const body = parseTemplateBody(v1)!;
    expect(body.version).toBe(2);
    expect(body.tasks[0]!.dueOffset).toBe(3); // the start day when there was no due date
    expect(body.tasks[0]!.values[String(body.fields[0]!.ref)]).toEqual({ option: "Y" });
    expect(body.tasks[0]!.assignee).toBeNull();
  });

  it("gives screens with the switch off the D-218 shape (old field types only)", () => {
    const legacy = legacyView(sample());
    expect(legacy.sections).toEqual(["Plan", "Do"]);
    expect(legacy.fields).toEqual([{ name: "Stage", kind: "SELECT", options: ["Draft", "Final"] }]);
    expect(legacy.tasks[0]!.fields).toEqual({ Stage: "Draft" });
    expect(readLegacyTemplate(sample())?.tasks[0]!.subtasks[0]!.title).toBe("Agenda");
    expect(parseTemplateBody("not json")).toBeNull();
    expect(parseTemplateBody({ version: 2, sections: [] })).toBeNull();
  });

  it("labels days from the start", () => {
    expect(offsetLabel(0)).toBe("Day 1");
    expect(offsetLabel(9)).toBe("Day 10");
    expect(offsetLabel(-1)).toBe("1 day before the start");
  });
});

describe("values travel by name and by days from the start (round trip)", () => {
  const start = "2026-12-01";
  const later = "2027-02-10";
  const key = (id: number) => (id === 900 ? "t9" : null);
  const idOf = (k: string) => (k === "t9" ? 5000 : null);
  it.each([
    [select, { ...empty, optionId: 102 }, { option: "Final" }, 102],
    [multi, { ...empty, ids: [202, 201] }, { options: ["Durg", "Raipur"] }, [202, 201]],
    [text, { ...empty, text: "Acme" }, { text: "Acme" }, "Acme"],
    [number, { ...empty, number: 12.5 }, { number: 12.5 }, 12.5],
    [people, { ...empty, ids: [3, 4] }, { people: [3, 4] }, [3, 4]],
  ])("%s", (field, stored, portable, back) => {
    expect(toPortable(field, stored, start, key)).toEqual(portable);
    expect(fromPortable(field, portable, later, idOf)).toEqual(back);
  });
  it("a date keeps its distance from the start (and its time)", () => {
    const portable = toPortable(date, { ...empty, date: "2026-12-11", time: "10:30" }, start, key)!;
    expect(portable).toEqual({ dateOffset: 10, time: "10:30" });
    expect(fromPortable(date, portable, later, idOf)).toBe(`${shiftDays(later, 10)}T10:30`);
  });
  it("a reference to another task in the template follows its key; others drop", () => {
    const reference: FieldDef = { id: 17, name: "Linked", type: "REFERENCE", config: DEFAULT_CONFIG, options: [] };
    expect(toPortable(reference, { ...empty, ids: [900, 901] }, start, key)).toEqual({ tasks: ["t9"] });
    expect(fromPortable(reference, { tasks: ["t9", "t10"] }, later, idOf)).toEqual([5000]);
  });
  it("worked-out types don't travel; an option that no longer exists is left out", () => {
    const formula: FieldDef = { id: 18, name: "Total", type: "FORMULA", config: DEFAULT_CONFIG, options: [] };
    expect(toPortable(formula, { ...empty, number: 3 }, start, key)).toBeNull();
    expect(fromPortable(select, { option: "Gone" }, later, idOf)).toBeUndefined();
    expect(fromPortable(select, { option: "final" }, later, idOf)).toBe(102);
  });
});

describe("remapRefs: settings point at the new project's ids", () => {
  const maps: IdMaps = { fields: new Map([[11, 911]]), options: new Map([[101, 9101]]), sections: new Map([[1, 81], [2, 82]]), forms: new Map([[5, 55]]), optionFields: new Set([11]) };
  it("fields, options, sections and forms", () => {
    expect(remapRefs({ groupField: 11, fieldFilters: [{ fieldId: 11, op: "is", value: "101" }, { fieldId: 99, op: "is", value: "1" }], hiddenFields: [11, 99] }, maps)).toEqual({ groupField: 911, fieldFilters: [{ fieldId: 911, op: "is", value: "9101" }], hiddenFields: [911] });
    expect(remapRefs({ trigger: { type: "FORM_SUBMITTED", formId: 5, sectionId: 2 }, steps: [{ key: "a", type: "SET_FIELD", fieldId: 11, value: 101 }] }, maps)).toEqual({ trigger: { type: "FORM_SUBMITTED", formId: 55, sectionId: 82 }, steps: [{ key: "a", type: "SET_FIELD", fieldId: 911, value: 9101 }] });
    expect(remapRefs({ trigger: { type: "FIELD_CHANGED", field: "f11", value: 101 } }, maps)).toEqual({ trigger: { type: "FIELD_CHANGED", field: "f911", value: 9101 } });
    expect(remapRefs({ subject: "SECTION", op: "IS", value: "2" }, maps)).toEqual({ subject: "SECTION", op: "IS", value: "82" });
  });
  it("a step on a missing field keeps its place (the builder asks again); a mapping or permission on it goes", () => {
    expect(remapRefs([{ key: "a", type: "SET_FIELD", fieldId: 99, value: 1 }], maps)).toEqual([{ key: "a", type: "SET_FIELD", fieldId: null, value: 1 }]);
    expect(remapRefs({ q: { kind: "FIELD", fieldId: 99 }, r: { kind: "FIELD", fieldId: 11 }, s: { kind: "TASK", field: "title" } }, maps)).toEqual({ r: { kind: "FIELD", fieldId: 911 }, s: { kind: "TASK", field: "title" } });
    expect(remapRefs({ fields: [{ field: "field:11", role: "OWNER" }, { field: "field:99", role: "OWNER" }, { field: "due", role: "EDITOR" }] }, maps)).toEqual({ fields: [{ field: "field:911", role: "OWNER" }, { field: "due", role: "EDITOR" }] });
  });
  it("formulas and chart sections", () => {
    expect(remapRefs({ formula: "{f11} * 2 + {f99}" }, maps)).toEqual({ formula: "{f911} * 2 + {f0}" });
    expect(remapRefs({ filters: { sections: [1, 3] }, x: { by: "field", fieldId: 11 } }, maps)).toEqual({ filters: { sections: [81] }, x: { by: "field", fieldId: 911 } });
  });
});

describe("duplicate choices", () => {
  it("everything but status updates by default; parts that need tasks follow tasks", () => {
    expect(DEFAULT_DUPLICATE.statusUpdates).toBe(false);
    expect(readDuplicateChoice({}).parts).toEqual(DEFAULT_DUPLICATE);
    const none = readDuplicateChoice({ parts: { tasks: false, subtasks: "on", assignees: true }, shiftDays: "7" });
    expect(none.parts).toMatchObject({ tasks: false, subtasks: false, assignees: false, dependencies: false });
    expect(none.shiftDays).toBe(7);
    expect(readDuplicateChoice({ shiftDays: "lots" }).shiftDays).toBe(0);
  });
  it("trims the shape: no due dates means every task is due on the first day; no subtasks, no fields", () => {
    const choice = readDuplicateChoice({ parts: { ...DEFAULT_DUPLICATE, dueDates: false, subtasks: false, fields: false, assignees: false, automations: false } });
    const shape = applyChoice(sample(), choice);
    expect(shape.tasks.map((task) => task.dueOffset)).toEqual([0, 0]);
    expect(shape.tasks[0]!.subtasks).toEqual([]);
    expect(shape.fields).toEqual([]);
    expect(shape.tasks[0]!.values).toEqual({});
    expect(shape.tasks[0]!.assignee).toBeNull();
    expect(shape.automations).toEqual([]);
    expect(shape.dependencies).toHaveLength(1);
    expect(applyChoice(sample(), readDuplicateChoice({ parts: { tasks: false } })).dependencies).toEqual([]);
  });
});

describe("import: reading a file (D-383)", () => {
  it.each([
    ["2026-12-15", "2026-12-15"],
    ["15/12/2026", "2026-12-15"],
    ["5-1-27", "2027-01-05"],
    ["15.12.2026", "2026-12-15"],
    ["15 Dec 2026", "2026-12-15"],
    ["15-Dec-26", "2026-12-15"],
    ["December 15, 2026", "2026-12-15"],
    ["46371", "2026-12-15"],
    ["31/02/2026", null],
    ["tomorrow", null],
  ])("parseDay(%s)", (raw, day) => expect(parseDay(raw)).toBe(day));

  it("priorities by their names (and codes)", () => {
    expect(parsePriority("Critical")).toBe("URGENT");
    expect(parsePriority("high")).toBe("ELEVATED"); // the label "High"
    expect(parsePriority("most important")).toBe("HIGH");
    expect(parsePriority("whenever")).toBeNull();
  });

  const crowd = [
    { id: 1, name: "Sita Staff", email: "sita@x.in", loginId: "E2E_STAFF" },
    { id: 2, name: "Ravi Kumar", email: "ravi1@x.in", loginId: "R1" },
    { id: 3, name: "Ravi Kumar", email: "ravi2@x.in", loginId: "R2" },
  ];
  it("people by email, User ID or a name only one person has", () => {
    expect(matchPerson("SITA@X.IN", crowd)).toEqual({ id: 1, name: "Sita Staff" });
    expect(matchPerson("e2e_staff", crowd)).toEqual({ id: 1, name: "Sita Staff" });
    expect(matchPerson("Sita Staff", crowd)).toEqual({ id: 1, name: "Sita Staff" });
    expect(matchPerson("Ravi Kumar - R2", crowd)).toEqual({ id: 3, name: "Ravi Kumar" });
    expect("error" in matchPerson("Ravi Kumar", crowd)).toBe(true);
    expect("error" in matchPerson("Nobody", crowd)).toBe(true);
  });

  it("guesses each column once, and fields by name", () => {
    expect(guessMapping(["Task name", "Due date", "Assignee", "Stage", "Name", "Other"], [select])).toEqual(["title", "due", "assignee", "field:11", "skip", "skip"]);
  });

  it("the dry run reports each row's problems; mandatory name and due date; new sections", () => {
    const mapping: Target[] = ["title", "due", "assignee", "section", "priority", "field:11", "field:12"];
    const plan = planImport({
      header: ["Name", "Due", "Who", "Section", "Priority", "Stage", "Plants"],
      rows: [
        { line: 2, cells: ["Order steel", "15/12/2026", "sita@x.in", "Buy", "Critical", "Final", "Raipur; Durg"] },
        { line: 3, cells: ["", "16/12/2026", "", "", "", "", ""] },
        { line: 4, cells: ["No date", "", "Ravi Kumar", "Do", "Soon", "Nope", "Bhilai"] },
        { line: 5, cells: ["", "", "", "", "", "", ""] },
      ],
      mapping,
      fields: [select, multi],
      people: crowd,
      sections: ["Do"],
    });
    expect(plan.problems).toEqual([]);
    expect(plan.ready).toBe(1);
    expect(plan.withErrors).toBe(2);
    expect(plan.newSections).toEqual(["Buy"]);
    const [good, noName, bad] = plan.rows;
    expect(good).toMatchObject({ title: "Order steel", dueDay: "2026-12-15", assigneeId: 1, section: "Buy", newSection: true, priority: "URGENT", values: [{ fieldId: 11, value: 102 }, { fieldId: 12, value: [201, 202] }] });
    expect(noName!.errors).toEqual(["The task name is empty."]);
    expect(bad!.errors.join(" ")).toMatch(/More than one person.*due date is empty.*isn't a priority.*Stage.*Plants/);
    expect(bad!.section).toBe("Do");
  });

  it("refuses a file without a name or due column, two columns for one thing, or too many rows", () => {
    const plan = planImport({ header: ["A", "B"], rows: [{ line: 2, cells: ["x", "y"] }], mapping: ["description", "description"], fields: [], people: [], sections: [] });
    expect(plan.problems.join(" ")).toMatch(/task name.*due date.*Two columns/);
    const many = planImport({ header: ["Name", "Due"], rows: Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, index) => ({ line: index + 2, cells: ["T", "2026-12-15"] })), mapping: ["title", "due"], fields: [], people: [], sections: [] });
    expect(many.problems[0]).toMatch(/at most 500/);
  });
});

describe("iCalendar output", () => {
  it("escapes text", () => {
    expect(escapeText("a,b;c\\d\nnext\r\nline")).toBe("a\\,b\\;c\\\\d\\nnext\\nline");
  });
  it("folds lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"₹".repeat(40)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    expect(parts.map((part, index) => (index ? part.slice(1) : part)).join("")).toBe(line);
    expect(foldLine("short")).toBe("short");
  });
  it("one all-day event per task on its due day, CRLF lines", () => {
    const ics = buildCalendar({ name: "My Tasks, ARS", now: new Date("2026-11-22T10:00:00Z"), events: [{ uid: "task-1@ars-cms", day: "2026-12-31", title: "TSK-1 Close, books", description: "Assignee: Sita", url: "https://x/users/tasks/1", updatedAt: new Date("2026-11-20T00:00:00Z") }] });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:My Tasks\\, ARS\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n");
    expect(ics).toContain("SUMMARY:TSK-1 Close\\, books\r\n");
    expect(ics).toContain("DTSTAMP:20261122T100000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});
