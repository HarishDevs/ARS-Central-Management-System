import { describe, expect, it } from "vitest";
import { meetingMessages } from "@/server/modules/messages";
import { calendarKindAllowed } from "@/server/modules/modules";
import { KINDS, KIND_LABEL } from "@/server/calendar/views";
import { scheduleProblems } from "@/server/meetings/rules";

// v1.55.2 (D-330, owner, 18 Nov 2026): meeting scheduling notifications carry
// the details and the link; meetings are on the calendar; the end follows the start.
const meeting = {
  id: 7,
  meetingNo: "MTG-2026-000007",
  title: "Plant review",
  start: new Date("2026-11-20T09:30:00Z"), // 3:00 pm India time
  end: new Date("2026-11-20T10:30:00Z"),
  mode: "ONLINE",
  venue: "Board room",
  link: "https://meet.example.com/abc",
};

describe("meeting invitation (D-330)", () => {
  it("names the time, the place, the link and the person's role", () => {
    const sent = meetingMessages.invited(meeting, 5, "Asha", "COORDINATOR");
    expect(sent.message).toContain("Plant review");
    expect(sent.message).toMatch(/to 0?4:00\s*pm/i);
    expect(sent.message).toContain("Online, Board room");
    expect(sent.message).toContain("Join: https://meet.example.com/abc");
    expect(sent.message).toContain("You are the Coordinator");
    expect(sent.email?.text).toContain("https://meet.example.com/abc");
  });
  it("the person who scheduled it gets a copy", () => {
    const copy = meetingMessages.scheduled(meeting, 1, 4);
    expect(copy.eventType).toBe("MEETING_INVITED");
    expect(copy.title).toBe("Meeting scheduled: Plant review");
    expect(copy.message).toContain("4 people were told");
  });
});

describe("meetings on the calendar (D-330)", () => {
  it("are a kind of entry for everyone on a meeting, whatever their modules (D-333)", () => {
    expect(KINDS).toContain("meeting");
    expect(KIND_LABEL.meeting).toBe("Meetings");
    expect(calendarKindAllowed({ roles: ["USER"], modules: ["MEETING"] }, "meeting")).toBe(true);
    expect(calendarKindAllowed({ roles: ["USER"], modules: ["APPROVAL"] }, "meeting")).toBe(true);
  });
});

describe("the end must be after the start (server check)", () => {
  it("refuses an end before or at the start", () => {
    const base = { title: "Review", typeId: 1, ownerId: 1, coordinatorId: 1, participantIds: [], departmentIds: [], agendaDueAt: null, momDueAt: null, mode: "OFFLINE", link: "" };
    const start = new Date("2026-11-20T09:30:00Z");
    expect(scheduleProblems({ ...base, start, end: new Date("2026-11-20T05:30:00Z") }, start).end).toBe("The end must be after the start.");
    expect(scheduleProblems({ ...base, start, end: new Date("2026-11-20T10:30:00Z") }, start).end).toBeUndefined();
  });
});
