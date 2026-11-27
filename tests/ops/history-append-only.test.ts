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
// v1.94.0 (D-455, owner: "Bin, then purge"): Super Admin's Delete permanently of
// a request or ticket 30+ days in the bin also removes its comment edit history
// (the optional trigger allows exactly that); only inside its two purge functions.
const SUPER_PURGE_FILE = path.join("server", "superadmin", "control", "service.ts");
const SUPER_PURGE_FUNCTIONS = ["async function purgeRequestRows", "async function purgeTicketRows"];
// The request timeline and comments, and the audit log: never deleted anywhere
// else, and the audit log never at all.
const REQUEST_HISTORY = ["approval_events", "request_comments"];

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
      if (relative === PURGE_FILE || relative === SUPER_PURGE_FILE) continue;
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


  it("keeps Super Admin's permanent delete of history inside its purge functions (v1.94.0, D-455)", () => {
    const text = readFileSync(path.join(ROOT, SUPER_PURGE_FILE), "utf8");
    const bodies = SUPER_PURGE_FUNCTIONS.map((name) => {
      const start = text.indexOf(name);
      expect(start, name).toBeGreaterThan(-1);
      const ends = [text.indexOf("\nasync function ", start + 1), text.indexOf("\nexport ", start + 1), text.indexOf("\nfunction ", start + 1)].filter((value) => value > -1);
      return { start, end: ends.length ? Math.min(...ends) : text.length };
    });
    let outside = text;
    for (const { start, end } of [...bodies].sort((a, b) => b.start - a.start)) outside = outside.slice(0, start) + outside.slice(end);
    for (const table of [...HISTORY, ...REQUEST_HISTORY]) expect(new RegExp(`DELETE FROM \`?${table}\\b`).test(outside), table).toBe(false);
  });

  it("deletes request timelines and comments only in Super Admin's purge, and never touches the audit log", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(ROOT, file);
      const text = readFileSync(file, "utf8");
      if (/\bDELETE\s+(?:\w+\s+)?FROM\s+`?audit_logs\b/i.test(text) || /\bUPDATE\s+`?audit_logs\b/i.test(text)) offenders.push(`${relative}: changes audit_logs`);
      if (relative === SUPER_PURGE_FILE) continue;
      for (const table of REQUEST_HISTORY) if (new RegExp(`\\bDELETE\\s+FROM\\s+\`?${table}\\b`, "i").test(text)) offenders.push(`${relative}: deletes ${table}`);
    }
    expect(offenders).toEqual([]);
  });
});
