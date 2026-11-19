import { sqlDir, type SortDir } from "@/server/lists/sorting";

// v1.58.0 (D-354, owner: "i need sorting in all the tables asc to desc or vice
// versa in all columns"): the Meetings list is paged, so its columns sort in
// SQL. Only these keys reach ORDER BY; each maps to a fixed expression over the
// listMeetings query (m = meetings, t = type, o = owner, c = coordinator,
// d = department). Pure (tested in tests/lists/meetings-sort.test.ts).
export const MEETING_SORT_COLUMNS = ["no", "title", "when", "mode", "owner", "coordinator", "dept", "priority", "invited", "status"] as const;
export type MeetingSortColumn = (typeof MEETING_SORT_COLUMNS)[number];

export const MEETING_SORT_LABEL: Record<MeetingSortColumn, string> = {
  no: "Meeting",
  title: "Title",
  when: "Date and time",
  mode: "Mode / venue",
  owner: "Owner",
  coordinator: "Coordinator",
  dept: "Department",
  priority: "Priority",
  invited: "Invited",
  status: "Status",
};

// [expression, may be empty]; empty values stay last in both directions.
const MEETING_SORT_SQL: Record<MeetingSortColumn, [string, boolean][]> = {
  no: [["m.meeting_no", false]],
  title: [["m.title", false]],
  when: [["m.scheduled_start", false]],
  mode: [
    ["m.mode", false],
    ["NULLIF(m.venue, '')", true],
  ],
  owner: [["o.name", false]],
  coordinator: [["c.name", false]],
  dept: [["d.name", true]],
  // Priority from lowest (Normal) to highest (Critical).
  priority: [["FIELD(m.priority, 'NORMAL', 'ELEVATED', 'IMPORTANT', 'HIGH', 'URGENT')", false]],
  invited: [["participants", false]],
  // Status in its life order (Scheduled ... Closed, Cancelled).
  status: [["FIELD(m.status, 'SCHEDULED', 'IN_PROGRESS', 'AWAITING_MOM', 'MOM_SUBMITTED', 'MOM_RETURNED', 'MOM_APPROVED', 'CLOSED', 'CANCELLED')", false]],
};

export const isMeetingSortColumn = (value: unknown): value is MeetingSortColumn => typeof value === "string" && (MEETING_SORT_COLUMNS as readonly string[]).includes(value);

// The ORDER BY for listMeetings: a chosen column (ties by date, then newest
// id), or the tab's own order (Upcoming soonest first, others latest first).
export function meetingOrderSql(tab: string, sortBy: MeetingSortColumn | null | undefined, dir: SortDir = "asc"): string {
  if (!isMeetingSortColumn(sortBy)) return `${tab === "upcoming" ? "m.scheduled_start ASC" : "m.scheduled_start DESC"}, m.id DESC`;
  const parts = MEETING_SORT_SQL[sortBy].flatMap(([expr, nullable]) => (nullable ? [`${expr} IS NULL`, `${expr} ${sqlDir(dir)}`] : [`${expr} ${sqlDir(dir)}`]));
  if (sortBy !== "when") parts.push("m.scheduled_start DESC");
  return [...parts, "m.id DESC"].join(", ");
}
