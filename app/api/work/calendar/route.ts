import { requireApiArea } from "@/server/authorization/guards";
import { apiError } from "@/lib/http/api-response";
import { logError } from "@/lib/logging/logger";
import { loadHolidayCalendar } from "@/server/work/holiday-store";
import { WEEKDAYS } from "@/server/workflows/calendar";

// v1.75.0 (D-399): what the shared date picker dims: the organisation's
// holidays (Admin → Working calendar, about a year back and two ahead, with
// their names) and the working weekdays (0 = Sunday). Anyone signed in to
// the users area may read it (the same list every task date is checked
// against); the browser keeps it for five minutes.
export async function GET() {
  try {
    await requireApiArea("users");
  } catch {
    return apiError("NOT_FOUND", "Not found.", 404);
  }
  try {
    const calendar = await loadHolidayCalendar();
    const workingWeekdays = [...calendar.workingDays].map((day) => WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number])).filter((day) => day >= 0).sort();
    return Response.json(
      { holidays: Object.fromEntries([...calendar.holidays.entries()].sort(([a], [b]) => (a < b ? -1 : 1))), workingWeekdays },
      { headers: { "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    logError("work calendar failed", error);
    return apiError("SYSTEM_ERROR", "Couldn't load the calendar.", 500);
  }
}
