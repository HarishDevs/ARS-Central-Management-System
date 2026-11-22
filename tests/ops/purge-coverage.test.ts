import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// v1.67.1 (D-379): the 30-day purge (server/work/purge.ts → pm.repository
// purgeTasks / purgeProject) must clear every table that points at a task or a
// project before deleting it, or one row stops the whole batch. Forms (D-374)
// and dashboards (D-375) were added without it. This reads every migration's
// foreign keys to tasks / projects / their children and checks the purge code
// names each table (or that the table is listed below with the reason).
const ROOT = path.join(__dirname, "..", "..");
const PARENTS = ["tasks", "projects", "project_sections", "project_fields", "project_forms", "project_form_versions", "task_comments", "portfolios", "portfolio_items", "portfolio_fields", "project_messages"]; // v1.71.0 (D-384): project messages too
const NOT_PURGED: Record<string, string> = {
  tasks: "self references (subtasks), deleted children first",
  tickets: "a ticket's task is never purged (purgeTaskCandidates)",
  meeting_actions: "a meeting's task is never purged (purgeTaskCandidates)",
};

function references(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const dir = path.join(ROOT, "database", "migrations");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    let table: string | null = null;
    for (const line of readFileSync(path.join(dir, file), "utf8").split(/\r?\n/)) {
      if (/^\s*--/.test(line)) continue;
      const opened = /^\s*(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE)\s+`?(\w+)/i.exec(line);
      if (opened) table = opened[1]!;
      const ref = /REFERENCES\s+`?(\w+)`?\s*\(/i.exec(line);
      if (ref && table && PARENTS.includes(ref[1]!)) {
        if (!found.has(table)) found.set(table, new Set());
        found.get(table)!.add(ref[1]!);
      }
    }
  }
  return found;
}

describe("the 30-day purge covers every table that points at a task or a project", () => {
  it("names each such table in the purge code", () => {
    const code = readFileSync(path.join(ROOT, "lib", "db", "repositories", "pm.repository.ts"), "utf8");
    const missing = [...references().keys()].filter((table) => !NOT_PURGED[table] && !new RegExp(`\\b${table}\\b`).test(code));
    expect(missing).toEqual([]);
  });
});
