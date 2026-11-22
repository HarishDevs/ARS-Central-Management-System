import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { splitStatements } = require("../../scripts/database/migrate.js") as { splitStatements: (sql: string) => string[] };

// v1.63.1: GoDaddy's MySQL (binary logging) refuses CREATE/DROP TRIGGER for the
// app's user. `npm start` runs the migrations first, so one unmarked trigger
// stops the app from starting ("Process exited before becoming ready"), as
// 202611211000_comment_edits.sql did. Every trigger statement since v1.9.0
// (when "-- @optional" arrived) must be optional.
const DIR = path.join(__dirname, "..", "..", "database", "migrations");
const SINCE = "202610160900"; // v1.9.0; older files are already applied everywhere

describe("migration trigger statements", () => {
  it("are all marked -- @optional, so a hosted database without SUPER still starts the app", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).filter((name) => name.endsWith(".sql") && name >= SINCE)) {
      splitStatements(readFileSync(path.join(DIR, file), "utf8")).forEach((statement, index) => {
        const sql = statement.replace(/--.*$/gm, "");
        if (/\b(CREATE|DROP)\s+TRIGGER\b/i.test(sql) && !statement.startsWith("-- @optional")) offenders.push(`${file} statement ${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
