import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 22 Nov 2026 (D-403 follow-up): GoDaddy's MySQL refuses CREATE TRIGGER for the
// app's user (SUPER + binary logging), so the append-only triggers in
// database/optional/ can't be installed on publish. This test enforces the same
// rule in the code instead, on every release: the history tables are never
// UPDATEd, and rows are DELETEd only by the 30-day purge of tasks in Deleted
// (pm.repository.ts purgeTasks, D-368/D-385/D-391).
const ROOT = path.join(__dirname, "..", "..");
const DIRS = ["lib", "server", "app", "features", "scripts"];
const HISTORY = ["task_events", "info_events", "comment_versions"];
const PURGE_FILE = path.join("lib", "db", "repositories", "pm.repository.ts");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe("history tables are append-only in the code (stands in for the optional triggers)", () => {
  const files = DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

  it("never UPDATEs task_events, info_events or comment_versions", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const table of HISTORY) {
        if (new RegExp(`\\bUPDATE\\s+\`?${table}\\b`, "i").test(text)) offenders.push(`${path.relative(ROOT, file)}: UPDATE ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("deletes their rows only in the 30-day task purge", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(ROOT, file);
      if (relative === PURGE_FILE) continue;
      const text = readFileSync(file, "utf8");
      for (const table of HISTORY) {
        if (new RegExp(`\\bDELETE\\s+FROM\\s+\`?${table}\\b`, "i").test(text) || new RegExp(`["'\`]${table}["'\`]\\s*[\\],]`).test(text) && /DELETE FROM \$\{/.test(text)) {
          offenders.push(`${relative}: deletes ${table}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps those deletes inside purgeTasks", () => {
    const text = readFileSync(path.join(ROOT, PURGE_FILE), "utf8");
    const start = text.indexOf("export async function purgeTasks");
    expect(start).toBeGreaterThan(-1);
    const next = text.indexOf("\nexport ", start + 1);
    const body = text.slice(start, next === -1 ? undefined : next);
    const outside = text.slice(0, start) + (next === -1 ? "" : text.slice(next));
    expect(/DELETE FROM comment_versions/.test(body) && /"task_events"/.test(body)).toBe(true);
    for (const table of HISTORY) expect(new RegExp(`DELETE FROM \`?${table}\\b`).test(outside)).toBe(false);
  });
});
