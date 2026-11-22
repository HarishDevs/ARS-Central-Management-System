import { describe, expect, it } from "vitest";
import {
  checkWorkDay,
  cleanBody,
  cleanNote,
  cleanPageBody,
  cleanPageTitle,
  cleanSubject,
  EMPTY_FILE_FILTER,
  elapsedMinutes,
  estimateProgress,
  fileKind,
  filterFiles,
  formatMinutes,
  hoursOf,
  mayChangeEntry,
  messageRecipients,
  newMentions,
  parseDuration,
  parseEstimate,
  parseFileFilter,
  sortFiles,
  taskLinkIds,
  taskLinkText,
  timeTotals,
  versionsToDrop,
  type FileItem,
} from "@/server/work/collab-rules";
import { addableViews, allowedView, buildStrip } from "@/server/work/view-tabs";

// v1.71.0 (D-384, PM phase E part 2): the pure rules of the Files, Messages
// and Page tabs and of time tracking.
const file = (over: Partial<FileItem>): FileItem => ({
  id: 1,
  name: "plan.pdf",
  contentType: "application/pdf",
  size: 100,
  createdAt: "2026-11-20T06:00:00.000Z",
  uploaderId: 5,
  uploaderName: "Asha",
  source: "TASK",
  taskId: 10,
  taskNo: "TSK-2026-000010",
  taskTitle: "Draw the plan",
  messageId: null,
  messageSubject: null,
  ...over,
});

describe("files", () => {
  it("knows a file's kind from its type and name", () => {
    expect(fileKind("image/png", "a.png")).toBe("image");
    expect(fileKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(fileKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx")).toBe("sheet");
    expect(fileKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBe("document");
    expect(fileKind("application/octet-stream", "a.zip")).toBe("other");
  });
  it("filters by type, task, person, India day and words", () => {
    const files = [file({ id: 1 }), file({ id: 2, name: "photo.jpg", contentType: "image/jpeg", uploaderId: 6, uploaderName: "Ravi", taskId: 11, createdAt: "2026-11-21T20:00:00.000Z" }), file({ id: 3, source: "MESSAGE", taskId: null, taskNo: null, taskTitle: null, messageId: 7, messageSubject: "Kick-off" })];
    expect(filterFiles(files, { ...EMPTY_FILE_FILTER, kind: "image" }).map((item) => item.id)).toEqual([2]);
    expect(filterFiles(files, { ...EMPTY_FILE_FILTER, taskId: 10 }).map((item) => item.id)).toEqual([1]);
    expect(filterFiles(files, { ...EMPTY_FILE_FILTER, uploaderId: 6 }).map((item) => item.id)).toEqual([2]);
    // 20:00 UTC on the 21st is the 22nd in India.
    expect(filterFiles(files, { ...EMPTY_FILE_FILTER, from: "2026-11-22" }).map((item) => item.id)).toEqual([2]);
    expect(filterFiles(files, { ...EMPTY_FILE_FILTER, to: "2026-11-21" }).map((item) => item.id)).toEqual([1, 3]);
    expect(filterFiles(files, { ...EMPTY_FILE_FILTER, search: "kick" }).map((item) => item.id)).toEqual([3]);
  });
  it("sorts and reads the filter from the address, dropping anything odd", () => {
    const files = [file({ id: 1, name: "b", size: 5, createdAt: "2026-11-20T00:00:00.000Z" }), file({ id: 2, name: "a", size: 9, createdAt: "2026-11-21T00:00:00.000Z" })];
    expect(sortFiles(files, "newest").map((item) => item.id)).toEqual([2, 1]);
    expect(sortFiles(files, "oldest").map((item) => item.id)).toEqual([1, 2]);
    expect(sortFiles(files, "name").map((item) => item.id)).toEqual([2, 1]);
    expect(sortFiles(files, "size").map((item) => item.id)).toEqual([2, 1]);
    expect(parseFileFilter({ fkind: "image", ftask: "12", fby: "x", ffrom: "2026-11-01", fto: "bad", fq: " plan " })).toEqual({ kind: "image", taskId: 12, uploaderId: null, from: "2026-11-01", to: "", search: "plan" });
    expect(parseFileFilter({ fkind: "exe" }).kind).toBe("");
  });
});

describe("messages", () => {
  it("cleans the subject and body", () => {
    expect(cleanSubject("  Kick-off \n meeting ")).toBe("Kick-off meeting");
    expect(cleanSubject("")).toBeNull();
    expect(cleanSubject("x".repeat(151))).toBeNull();
    expect(cleanBody("  \n ")).toBeNull();
    expect(cleanBody("Hello\r\nthere  ")).toBe("Hello\nthere");
    expect(cleanBody("x".repeat(10_001))).toBeNull();
  });
  it("tells members of a new thread, the thread's people of a reply, and mentions who may see the project", () => {
    const mayView = (id: number) => id !== 9;
    expect(messageRecipients({ authorId: 1, members: [1, 2, 3], threadPeople: null, mentioned: [], mayView })).toEqual({ notify: [2, 3], mentions: [], cannotSee: [] });
    expect(messageRecipients({ authorId: 2, members: [1, 2, 3], threadPeople: [1, 2], mentioned: [4, 9, 2], mayView })).toEqual({ notify: [1], mentions: [4], cannotSee: [9] });
    // A mentioned member is told once (as a mention).
    expect(messageRecipients({ authorId: 1, members: [1, 2, 3], threadPeople: null, mentioned: [3], mayView })).toEqual({ notify: [2], mentions: [3], cannotSee: [] });
  });
});

describe("page", () => {
  it("cleans the title and body (an empty page is allowed)", () => {
    expect(cleanPageTitle("  Brief  ")).toBe("Brief");
    expect(cleanPageTitle(undefined)).toBe("");
    expect(cleanPageTitle("x".repeat(151))).toBeNull();
    expect(cleanPageBody("")).toBe("");
    expect(cleanPageBody("x".repeat(100_001))).toBeNull();
  });
  it("finds new mentions and linked tasks", () => {
    expect(newMentions("Hi @[Asha](user:5)", "Hi @[Asha](user:5) and @[Ravi](user:6)")).toEqual([6]);
    const text = `See [TSK-1: Plan](https://cms.example/users/tasks/12) and [again](https://cms.example/users/tasks/12?x=1) and [other](/users/tasks/13) [not](https://cms.example/users/tasksx/14)`;
    expect(taskLinkIds(text)).toEqual([12, 13]);
    expect(taskLinkText("https://cms.example/", { id: 12, taskNo: "TSK-1", title: "Plan [v2]" })).toBe("[TSK-1: Plan  v2 ](https://cms.example/users/tasks/12)");
  });
  it("keeps the newest 50 versions", () => {
    const all = Array.from({ length: 53 }, (_, index) => index + 1);
    expect(versionsToDrop(all)).toEqual([3, 2, 1]);
    expect(versionsToDrop([1, 2])).toEqual([]);
  });
});

describe("time", () => {
  it("reads durations", () => {
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1h30m")).toBe(90);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("2 hours")).toBe(120);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("2")).toBe(120); // a small bare number is hours
    expect(parseDuration("90")).toBe(90); // a bigger one is minutes
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("25h")).toBeNull(); // an entry is at most a day
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration(30)).toBe(30);
  });
  it("reads estimates (empty clears)", () => {
    expect(parseEstimate("")).toBeNull();
    expect(parseEstimate("40h")).toBe(2400);
    expect(parseEstimate("lots")).toBeUndefined();
  });
  it("formats minutes and hours", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(135)).toBe("2h 15m");
    expect(hoursOf(90)).toBe(1.5);
  });
  it("checks the day: not in the future, at most a year back, a real date", () => {
    expect(checkWorkDay("2026-11-22", "2026-11-22")).toBe("2026-11-22");
    expect(checkWorkDay("2026-11-23", "2026-11-22")).toBeNull();
    expect(checkWorkDay("2025-11-20", "2026-11-22")).toBeNull();
    expect(checkWorkDay("2026-02-30", "2026-11-22")).toBeNull();
    expect(checkWorkDay(5, "2026-11-22")).toBeNull();
  });
  it("cleans notes", () => {
    expect(cleanNote("  site visit  ")).toBe("site visit");
    expect(cleanNote("")).toBeNull();
    expect(cleanNote("x".repeat(501))).toBeUndefined();
  });
  it("works out a stopped timer (at least a minute, at most a day)", () => {
    const start = new Date("2026-11-22T04:00:00Z");
    expect(elapsedMinutes(start, new Date("2026-11-22T05:30:20Z"))).toEqual({ minutes: 90, capped: false });
    expect(elapsedMinutes(start, new Date("2026-11-22T04:00:10Z"))).toEqual({ minutes: 1, capped: false });
    expect(elapsedMinutes(start, new Date("2026-11-24T04:00:00Z"))).toEqual({ minutes: 1440, capped: true });
  });
  it("lets the person, IT and the project's owners and editors change an entry", () => {
    expect(mayChangeEntry(5, { id: 5, isAdmin: false, projectRole: null })).toBe(true);
    expect(mayChangeEntry(5, { id: 6, isAdmin: false, projectRole: "COMMENTER" })).toBe(false);
    expect(mayChangeEntry(5, { id: 6, isAdmin: false, projectRole: "EDITOR" })).toBe(true);
    expect(mayChangeEntry(5, { id: 6, isAdmin: false, projectRole: "OWNER" })).toBe(true);
    expect(mayChangeEntry(5, { id: 6, isAdmin: true, projectRole: null })).toBe(true);
  });
  it("adds up per person (running entries left out) and against the estimate", () => {
    const totals = timeTotals([
      { userId: 1, userName: "Asha", minutes: 30 },
      { userId: 2, userName: "Ravi", minutes: 90 },
      { userId: 1, userName: "Asha", minutes: 15 },
      { userId: 2, userName: "Ravi", minutes: null },
    ]);
    expect(totals).toEqual({ total: 135, people: [{ userId: 2, name: "Ravi", minutes: 90 }, { userId: 1, name: "Asha", minutes: 45 }] });
    expect(estimateProgress(135, 120)).toEqual({ percent: 113, over: true });
    expect(estimateProgress(60, null)).toEqual({ percent: null, over: false });
  });
});

describe("tabs", () => {
  it("offers Files, Messages and Page only with pm_extras on, and only for projects", () => {
    expect(addableViews("PROJECT", true, true, false).map((entry) => entry.type)).not.toContain("FILES");
    expect(addableViews("PROJECT", false, false, true).map((entry) => entry.type)).toEqual(expect.arrayContaining(["FILES", "MESSAGES", "PAGE"]));
    expect(addableViews("MY_TASKS", true, true, true).map((entry) => entry.type)).not.toContain("PAGE");
    expect(allowedView("PROJECT", "PAGE")).toBe(false);
    expect(allowedView("PROJECT", "PAGE", false, false, true)).toBe(true);
    expect(allowedView("MY_TASKS", "MESSAGES", false, false, true)).toBe(false);
    expect(buildStrip([{ id: 1, type: "FILES", name: "Files", config: {}, isDefault: false, position: 1 }], true, "list")[0]).toMatchObject({ type: "FILES", isDefault: true });
  });
});
