// D-215: how dates read on task rows (India time). Pure.
// v1.89.0 (D-425): both come from the app's one formatter (lib/format/date.ts).
import { formatRelativeDay, indiaDay } from "@/lib/format/date";

export const indiaDayOf = (value: Date) => indiaDay(value);

// Today / Tomorrow / Yesterday, a weekday name within the coming week (D-219), else "21 Nov" (this year) or "21 Nov 2027".
export function dayText(day: string, today: string): string {
  return formatRelativeDay(day, today);
}

export function dueLabel(dueAt: Date | string | null, now: Date, open: boolean): { text: string; tone: "danger" | "success" | "neutral" } | null {
  if (!dueAt) return null;
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const day = indiaDayOf(due);
  const today = indiaDayOf(now);
  const text = dayText(day, today);
  if (!open) return { text, tone: "neutral" };
  // Overdue in red; today in green (screen catalog §1.4).
  return { text, tone: day < today ? "danger" : day === today ? "success" : "neutral" };
}

export const TONE_TEXT: Record<"danger" | "success" | "neutral", string> = { danger: "text-danger-600", success: "text-success-600", neutral: "text-ink-muted" };
