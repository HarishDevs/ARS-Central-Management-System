import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main, DEFAULT_FILE } = require("../../scripts/database/restore-on-start.js") as {
  main: (env: Record<string, string | undefined>) => Promise<{ status: string }>;
  DEFAULT_FILE: string;
};

// D-403: the one-time restore must do nothing unless the owner confirms it,
// and must never touch the database on a mismatch or a missing file.
describe("restore-on-start guards (no database needed)", () => {
  it("is skipped when RESTORE_CONFIRM is not set", async () => {
    expect((await main({ DB_NAME: "db_x" })).status).toBe("skipped");
  });
  it("does nothing when RESTORE_CONFIRM does not match DB_NAME", async () => {
    expect((await main({ DB_NAME: "db_x", RESTORE_CONFIRM: "db_y" })).status).toBe("mismatch");
  });
  it("does nothing when the backup file is missing", async () => {
    expect((await main({ DB_NAME: "db_x", RESTORE_CONFIRM: "db_x", RESTORE_FILE: path.join(__dirname, "no-such.sql.gz.enc") })).status).toBe("missing");
  });
  it("ships the bundle encrypted, with its checksum", () => {
    expect(existsSync(DEFAULT_FILE)).toBe(true);
    expect(readFileSync(DEFAULT_FILE).subarray(0, 6).toString()).toBe("ARSBK1");
    expect(existsSync(`${DEFAULT_FILE}.sha256`)).toBe(true);
  });
  it("runs before the migrations in npm start", () => {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(pkg.scripts.start.startsWith("node scripts/database/restore-on-start.js && node scripts/database/migrate.js")).toBe(true);
  });
});
