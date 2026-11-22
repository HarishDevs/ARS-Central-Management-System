import { describe, expect, it } from "vitest";
import type { FormField } from "@/server/forms/fields";
import { parseFormSubmission, NO_LOOKUPS } from "@/server/forms/fields";
import { visibleFields } from "@/server/forms/dynamic";
import {
  branchCandidates,
  branchDepth,
  branchOf,
  branchTargets,
  checkIntakeForm,
  cleanMappings,
  connectChoices,
  DEFAULT_SETTINGS,
  describeSubmission,
  dueAnswerProblem,
  dueDayFor,
  mappingProblem,
  mayFill,
  parseDraft,
  parseSettings,
  priorityFromLabel,
  setBranch,
  submissionTitle,
  type IntakeSettings,
  type ProjectFieldInfo,
} from "@/server/work/intake-rules";
import { newIntakeQuestion, choicesFor } from "@/features/admin/form-designer/model";

// v1.66.0 (D-374, PM phase C): project intake form rules (pure).
const q = (key: string, type: FormField["type"], extra: Partial<FormField> = {}): FormField => ({ key, label: extra.label ?? key, type, required: false, ...extra });
const projectFields: ProjectFieldInfo[] = [
  { id: 1, name: "Stage", type: "SELECT", options: [{ name: "New" }, { name: "Urgent" }, { name: "Old", archived: true }] },
  { id: 2, name: "Cost", type: "NUMBER", options: [] },
  { id: 3, name: "Notes", type: "TEXT", options: [] },
  { id: 4, name: "Needed by", type: "DATE", options: [] },
  { id: 5, name: "Tags", type: "MULTI_SELECT", options: [{ name: "A" }, { name: "B" }] },
  { id: 6, name: "Code", type: "ID", options: [] },
  { id: 7, name: "Owner", type: "PEOPLE", options: [] },
];
const settings = (change: Partial<IntakeSettings> = {}): IntakeSettings => ({ ...DEFAULT_SETTINGS, sectionId: 10, assigneeId: 99, ...change });
const ctx = { sectionIds: [10], projectFields, assigneeActive: true };

describe("question types in the shared designer", () => {
  it("offers only the intake types, with their own names", () => {
    expect(choicesFor("PROJECT_INTAKE").map((choice) => choice.label)).toEqual(["Text", "Long text", "Single-select", "Multi-select", "Date", "Number", "Attachment", "Heading"]);
    expect(choicesFor("STANDARD").length).toBeGreaterThan(10);
  });
  it("gives a new question a stable key of its own and one file for attachments", () => {
    expect(newIntakeQuestion("CHOICE", [])).toMatchObject({ key: "q", label: "New question", type: "CHOICE", options: [] });
    expect(newIntakeQuestion("TEXT", ["q"]).key).toBe("q_2");
    expect(newIntakeQuestion("ATTACHMENT", ["q", "q_2"])).toMatchObject({ key: "q_3", maxFiles: 1 });
    expect(newIntakeQuestion("SECTION", [])).toMatchObject({ label: "Heading", type: "SECTION" });
  });
});

describe("form validation (publish)", () => {
  const valid = { name: "IT request", draft: { fields: [q("summary", "TEXT", { label: "Summary", required: true })], mappings: {} }, settings: settings() };
  it("accepts a valid form", () => {
    expect(checkIntakeForm(valid, ctx)).toEqual([]);
  });
  it("needs a title, a question, a section, an assignee and a due offset (C-2, C-3)", () => {
    const messages = checkIntakeForm({ name: " ", draft: { fields: [q("h", "SECTION")], mappings: {} }, settings: settings({ assigneeId: null, dueOffsetDays: null }) }, { ...ctx, sectionIds: [] }).map((problem) => problem.message);
    expect(messages).toEqual(expect.arrayContaining(["Give the form a title.", "Add at least one question.", "Choose a default assignee (Settings).", "Set the due date: how many working days after the submission (Settings).", "Add a section to the project first: submissions go into a section."]));
  });
  it("flags a select question without values and an inactive assignee", () => {
    const messages = checkIntakeForm({ ...valid, draft: { fields: [q("pick", "CHOICE", { label: "Pick", options: [] })], mappings: {} } }, { ...ctx, assigneeActive: false }).map((problem) => problem.message);
    expect(messages).toContain("“Pick”: question values must be specified.");
    expect(messages.some((message) => message.includes("isn't an active person"))).toBe(true);
  });
  it("refuses types a project form can't use", () => {
    expect(checkIntakeForm({ ...valid, draft: { fields: [q("who", "PERSON")], mappings: {} } }, ctx)[0]?.message).toContain("can't be used on a project form");
  });
  it("needs departments when only departments may submit", () => {
    expect(checkIntakeForm({ ...valid, settings: settings({ audience: "DEPARTMENTS", departmentIds: [] }) }, ctx).map((problem) => problem.message)).toContain("Choose at least one department that may submit (Settings).");
  });
  it("reads stored drafts and settings leniently", () => {
    expect(parseDraft("not json")).toEqual({ fields: [], mappings: {} });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ copyToDescription: true, dueOffsetDays: 3, audience: "EVERYONE", submitAnother: false });
  });
});

describe("mapping compatibility (Connect to field)", () => {
  it("connects task fields by type; the assignee is never offered", () => {
    expect(mappingProblem(q("a", "TEXT"), { kind: "TASK", field: "title" }, [])).toBeNull();
    expect(mappingProblem(q("a", "LONG_TEXT"), { kind: "TASK", field: "title" }, [])).not.toBeNull();
    expect(mappingProblem(q("a", "LONG_TEXT"), { kind: "TASK", field: "description" }, [])).toBeNull();
    expect(mappingProblem(q("a", "DATE"), { kind: "TASK", field: "due" }, [])).toBeNull();
    expect(mappingProblem(q("a", "NUMBER"), { kind: "TASK", field: "due" }, [])).not.toBeNull();
    expect(mappingProblem(q("a", "CHOICE", { options: ["Critical", "Normal"] }), { kind: "TASK", field: "priority" }, [])).toBeNull();
    expect(mappingProblem(q("a", "CHOICE", { options: ["Soon", "Normal"] }), { kind: "TASK", field: "priority" }, [])).toContain("Soon");
    expect(connectChoices(q("a", "TEXT"), projectFields).map((choice) => choice.label)).not.toContain("Assignee");
    expect(priorityFromLabel("critical")).toBe("URGENT");
  });
  it("connects project fields only to answers of a matching type and options", () => {
    expect(mappingProblem(q("a", "CHOICE", { options: ["New", "urgent"] }), { kind: "FIELD", fieldId: 1 }, projectFields)).toBeNull();
    expect(mappingProblem(q("a", "CHOICE", { options: ["New", "Old"] }), { kind: "FIELD", fieldId: 1 }, projectFields)).toContain("“Old”"); // archived
    expect(mappingProblem(q("a", "TEXT"), { kind: "FIELD", fieldId: 2 }, projectFields)).not.toBeNull();
    expect(mappingProblem(q("a", "NUMBER"), { kind: "FIELD", fieldId: 2 }, projectFields)).toBeNull();
    expect(mappingProblem(q("a", "LONG_TEXT"), { kind: "FIELD", fieldId: 3 }, projectFields)).toBeNull();
    expect(mappingProblem(q("a", "DATE"), { kind: "FIELD", fieldId: 4 }, projectFields)).toBeNull();
    expect(mappingProblem(q("a", "MULTI_CHOICE", { options: ["A", "B"] }), { kind: "FIELD", fieldId: 5 }, projectFields)).toBeNull();
    expect(mappingProblem(q("a", "TEXT"), { kind: "FIELD", fieldId: 6 }, projectFields)).toContain("can't be filled in"); // ID
    expect(mappingProblem(q("a", "TEXT"), { kind: "FIELD", fieldId: 7 }, projectFields)).toContain("can't be filled in"); // People
    expect(mappingProblem(q("a", "ATTACHMENT"), { kind: "FIELD", fieldId: 3 }, projectFields)).not.toBeNull();
    expect(mappingProblem(q("a", "TEXT"), { kind: "FIELD", fieldId: 404 }, projectFields)).toContain("isn't in this project");
  });
  it("allows each target once and drops mappings of removed questions", () => {
    const fields = [q("a", "TEXT"), q("b", "TEXT")];
    const problems = checkIntakeForm({ name: "F", draft: { fields, mappings: { a: { kind: "TASK", field: "title" }, b: { kind: "TASK", field: "title" } } }, settings: settings() }, ctx);
    expect(problems.some((problem) => problem.message.includes("already connected"))).toBe(true);
    expect(cleanMappings([q("a", "TEXT")], { a: { kind: "FIELD", fieldId: 3 }, gone: { kind: "FIELD", fieldId: 2 } })).toEqual({ a: { kind: "FIELD", fieldId: 3 } });
  });
});

describe("branching (per option, on the shared show-if rules)", () => {
  const base = [q("kind", "CHOICE", { label: "Kind", options: ["Laptop", "Phone"] }), q("model", "TEXT", { label: "Model" }), q("why", "LONG_TEXT", { label: "Why" })];
  it("adds and removes a branch and the shared evaluator follows it", () => {
    let fields = setBranch(base, "kind", "Laptop", "model", true);
    expect(branchOf(fields[1]!)).toEqual({ source: "kind", options: ["Laptop"] });
    expect(branchTargets(fields, "kind", "Laptop")).toEqual(["model"]);
    expect([...visibleFields(fields, { kind: "Laptop" })]).toContain("model");
    expect([...visibleFields(fields, { kind: "Phone" })]).not.toContain("model");
    fields = setBranch(fields, "kind", "Phone", "model", true);
    expect([...visibleFields(fields, { kind: "Phone" })]).toContain("model");
    fields = setBranch(setBranch(fields, "kind", "Phone", "model", false), "kind", "Laptop", "model", false);
    expect(fields[1]!.showIf).toBeUndefined();
  });
  it("works for multi-select answers too", () => {
    const fields = setBranch([q("tags", "MULTI_CHOICE", { options: ["A", "B"] }), q("more", "TEXT")], "tags", "B", "more", true);
    expect([...visibleFields(fields, { tags: ["A", "B"] } as never)]).toContain("more");
    expect([...visibleFields(fields, { tags: ["A"] } as never)]).not.toContain("more");
  });
  it("hides a branched question's answer and its requiredness on the server", () => {
    const fields = setBranch([base[0]!, { ...base[1]!, required: true }], "kind", "Laptop", "model", true);
    expect(parseFormSubmission(fields, { kind: "Phone", model: "X1" }, new Set(), NO_LOOKUPS)).toEqual({ ok: true, data: { kind: "Phone" } });
    expect(parseFormSubmission(fields, { kind: "Laptop" }, new Set(), NO_LOOKUPS).ok).toBe(false);
  });
  it("offers only later questions, at most 5 levels deep, and checks order", () => {
    expect(branchCandidates(base, "model").map((field) => field.key)).toEqual(["why"]);
    let chain: FormField[] = Array.from({ length: 7 }, (_, i) => q(`s${i}`, "CHOICE", { options: ["Y", "N"] }));
    for (let i = 1; i < 7; i += 1) chain = setBranch(chain, `s${i - 1}`, "Y", `s${i}`, true);
    expect(branchDepth(chain, "s5")).toBe(5);
    expect(branchCandidates(chain, "s5")).toEqual([]);
    expect(checkIntakeForm({ name: "F", draft: { fields: chain, mappings: {} }, settings: settings() }, ctx).some((problem) => problem.message.includes("at most 5 levels"))).toBe(true);
    const backwards = setBranch([q("model", "TEXT"), base[0]!], "kind", "Laptop", "model", true);
    expect(checkIntakeForm({ name: "F", draft: { fields: backwards, mappings: {} }, settings: settings() }, ctx).some((problem) => problem.message.includes("must come after"))).toBe(true);
  });
});

describe("who may submit", () => {
  it("follows the audience; builders may always", () => {
    expect(mayFill({ audience: "EVERYONE", departmentIds: [] }, { departmentId: null, isMember: false, canBuild: false })).toBe(true);
    expect(mayFill({ audience: "MEMBERS", departmentIds: [] }, { departmentId: 1, isMember: false, canBuild: false })).toBe(false);
    expect(mayFill({ audience: "MEMBERS", departmentIds: [] }, { departmentId: 1, isMember: true, canBuild: false })).toBe(true);
    expect(mayFill({ audience: "DEPARTMENTS", departmentIds: [2] }, { departmentId: 1, isMember: true, canBuild: false })).toBe(false);
    expect(mayFill({ audience: "DEPARTMENTS", departmentIds: [2] }, { departmentId: 2, isMember: false, canBuild: false })).toBe(true);
    expect(mayFill({ audience: "DEPARTMENTS", departmentIds: [2] }, { departmentId: null, isMember: false, canBuild: true })).toBe(true);
  });
});

describe("the task", () => {
  it("is named by the mapped answer or '<Form name> submission'", () => {
    expect(submissionTitle("IT request", "  New   laptop ")).toBe("New laptop");
    expect(submissionTitle("IT request", "")).toBe("IT request submission");
    expect(submissionTitle("IT request", undefined)).toBe("IT request submission");
  });
  it("is due a number of working days later, skipping weekly offs and holidays", () => {
    const calendar = { offDays: new Set(["2026-11-25"]), workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) }; // Mon–Sat
    expect(dueDayFor("2026-11-23", 3, calendar)).toBe("2026-11-27"); // Tue, (Wed holiday), Thu, Fri
    expect(dueDayFor("2026-11-28", 1, calendar)).toBe("2026-11-30"); // Sat → (Sun off) → Mon
    expect(dueDayFor("2026-11-23", 0, calendar)).toBe("2026-11-23");
  });
  it("refuses a mapped due date in the past", () => {
    expect(dueAnswerProblem("2026-11-01", "2026-11-22")).toBe("Choose today or a later date.");
    expect(dueAnswerProblem("2026-11-22", "2026-11-22")).toBeNull();
    expect(dueAnswerProblem("", "2026-11-22")).toBeNull();
  });
  it("describes the answers as 'Label: value' lines, dates and files included, then the footer", () => {
    const fields = [q("summary", "TEXT", { label: "Summary" }), q("h", "SECTION", { label: "Details" }), q("needed", "DATE", { label: "Needed by" }), q("tags", "MULTI_CHOICE", { label: "Tags", options: ["A", "B"] }), q("skip", "TEXT", { label: "Optional" }), q("files", "ATTACHMENT", { label: "Files" }), q("hidden", "TEXT", { label: "Hidden" })];
    const text = describeSubmission({
      formName: "IT request",
      link: "https://x.test/users/forms/abc",
      submitter: { name: "Ravi", email: "ravi@example.test" },
      fields,
      data: { summary: "Laptop <b>broken</b>", needed: "2026-12-15", tags: ["A", "B"], files: 2, hidden: "secret" },
      shown: new Set(["summary", "h", "needed", "tags", "skip", "files"]),
      copyAll: true,
      descriptionKey: null,
      fileNames: { files: ["a.pdf", "b.png"] },
    });
    expect(text).toBe(
      "Name: Ravi\nEmail: ravi@example.test\nSummary: Laptop <b>broken</b>\nNeeded by: 15 Dec 2026\nTags: A, B\nFiles: a.pdf, b.png\n\n———\nSubmitted through the form IT request by Ravi.\nhttps://x.test/users/forms/abc",
    );
    const short = describeSubmission({ formName: "F", link: "L", submitter: { name: "R", email: "e" }, fields, data: { summary: "Lead text" }, shown: new Set(["summary"]), copyAll: false, descriptionKey: "summary", fileNames: {} });
    expect(short).toBe("Lead text\n\n———\nSubmitted through the form F by R.\nL");
    const long = describeSubmission({ formName: "F", link: "L", submitter: { name: "R", email: "e" }, fields: [q("t", "LONG_TEXT", { label: "T" })], data: { t: "x".repeat(5000) }, shown: new Set(["t"]), copyAll: true, descriptionKey: null, fileNames: {} });
    expect(long.length).toBeLessThanOrEqual(4000);
    expect(long.endsWith("by R.\nL")).toBe(true);
  });
});
