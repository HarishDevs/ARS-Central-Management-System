// v1.70.0 (D-383, PM phase E part 1): calendar feeds (iCalendar, RFC 5545).
// Pure and unit-tested: text escaping, line folding at 75 octets (UTF-8
// safe), and one all-day event per task on its due day.

export interface FeedEvent {
  uid: string; // stable per task
  day: string; // YYYY-MM-DD (the due day, India)
  title: string;
  description: string;
  url: string;
  updatedAt: Date;
}

// TEXT values: backslash, semicolon, comma and new lines escaped (§3.3.11).
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Lines longer than 75 octets are folded: CRLF and a space (§3.1). A
// character is never split across lines.
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74; // the leading space counts
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const compactDay = (day: string) => day.replace(/-/g, "");
function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function buildCalendar(input: { name: string; events: readonly FeedEvent[]; now?: Date }): string {
  const now = input.now ?? new Date();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ARS-CMS//Tasks//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(input.name)}`, "X-WR-TIMEZONE:Asia/Kolkata", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const event of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${stamp(now)}`,
      `LAST-MODIFIED:${stamp(event.updatedAt)}`,
      `DTSTART;VALUE=DATE:${compactDay(event.day)}`,
      `DTEND;VALUE=DATE:${compactDay(nextDay(event.day))}`,
      `SUMMARY:${escapeText(event.title)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      `URL:${event.url.replace(/[\r\n]/g, "")}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
