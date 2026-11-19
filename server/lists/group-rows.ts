// v1.57.5 (D-344, owner: "add group by option for all the pages where table is
// available"): one way to group a page of rows. `bucket` gives each row its
// group's label and an order (lower first; ties by label). Pure.
export interface RowGroup<T> {
  key: string;
  label: string;
  items: T[];
}

export function groupRows<T>(items: readonly T[], bucket: (item: T) => [string, number]): RowGroup<T>[] {
  const map = new Map<string, { order: number; items: T[] }>();
  for (const item of items) {
    const [label, order] = bucket(item);
    const entry = map.get(label) ?? { order, items: [] };
    entry.items.push(item);
    map.set(label, entry);
  }
  return [...map.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])).map(([label, entry]) => ({ key: label, label, items: entry.items }));
}

// A department name, or "No department" last.
export const departmentBucket = (name: string | null | undefined): [string, number] => (name ? [name, 0] : ["No department", 9]);

// A date (India day, YYYY-MM-DD) against today: Overdue, Today, Next 7 days, Later, No date.
export function dueBucket(day: string | null, today: string, open = true): [string, number] {
  if (!day) return ["No due date", 9];
  if (open && day < today) return ["Overdue", 0];
  if (day === today) return ["Today", 1];
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  if (day <= week) return ["Next 7 days", 2];
  return ["Later", 3];
}
export const indiaDayOf = (at: Date) => new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);

// Read ?group= against a list's own choices.
export function pickGroup<K extends string>(value: unknown, choices: readonly K[]): K | null {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && (choices as readonly string[]).includes(text) ? (text as K) : null;
}
