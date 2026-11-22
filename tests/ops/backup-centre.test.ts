import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatBytes, passphraseHint } from "@/features/superadmin/backup/types";
import { PACKAGE_NAME, packagePath } from "@/server/ops/backup-centre/storage";
import { backupEventText } from "@/server/ops/backup-centre/alerts";
import { selectPackagesForDeletion, uploadPiece } from "@/server/ops/gdrive";
import * as engine from "@/scripts/database/arsbak-engine";
import * as arsdb from "@/scripts/database/arsbak-db";

vi.mock("@/lib/db/repositories/users.repository", () => ({ listUserIdsWithRole: async () => [] }));
vi.mock("@/server/notifications/notify", () => ({ notify: async () => undefined }));

// D-408 (v1.81.0, BK-1): the centre's pure rules.
describe("backup centre rules", () => {
  it("names packages strictly and never resolves outside the packages folder", () => {
    expect(PACKAGE_NAME.test("ars-full-20261123-101112.arsbak")).toBe(true);
    expect(PACKAGE_NAME.test("ars-safety-20261123-101112-42.arsbak")).toBe(true);
    for (const bad of ["../ars-full-20261123-101112.arsbak", "ars-full-20261123-101112.arsbak/../../x", "ars-evil-20261123-101112.arsbak", "ars-full-2026.arsbak", ".ars-full-20261123-101112.arsbak.part"]) {
      expect(packagePath(bad)).toBeNull();
    }
    const file = packagePath("ars-full-20261123-101112.arsbak")!;
    expect(path.basename(path.dirname(file))).toBe("packages");
  });

  it("refuses file paths in a package that leave the upload folder", () => {
    expect(engine.safeRelative("2026/11/a.pdf")).toBe("2026/11/a.pdf");
    for (const bad of ["../x", "/etc/passwd", "C:/x", "a/../../b", "a//b", "./a", ""]) expect(() => engine.safeRelative(bad)).toThrow();
  });

  it("keeps only the known server secrets, and skips empty ones", () => {
    const picked = engine.secretsFromEnv({ ENCRYPTION_KEY: "k", DB_PASSWORD: "p", PATH: "/usr/bin", SESSION_SECRET: "" });
    expect(picked).toEqual({ ENCRYPTION_KEY: "k", DB_PASSWORD: "p" });
  });

  it("takes foreign keys and checks out of a CREATE TABLE and gives them back as clauses", () => {
    const create = [
      "CREATE TABLE `child` (",
      "  `id` int NOT NULL AUTO_INCREMENT,",
      "  `parent_id` int NOT NULL,",
      "  PRIMARY KEY (`id`),",
      "  KEY `fk_child_parent` (`parent_id`),",
      "  CONSTRAINT `fk_child_parent` FOREIGN KEY (`parent_id`) REFERENCES `parent` (`id`) ON DELETE CASCADE,",
      "  CONSTRAINT `chk_child` CHECK ((`id` > 0))",
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
    ].join("\n");
    const { sql, constraints } = arsdb.splitConstraints(create);
    expect(constraints).toEqual(["CONSTRAINT `fk_child_parent` FOREIGN KEY (`parent_id`) REFERENCES `parent` (`id`) ON DELETE CASCADE", "CONSTRAINT `chk_child` CHECK ((`id` > 0))"]);
    expect(sql).not.toContain("CONSTRAINT");
    expect(sql).toContain("  KEY `fk_child_parent` (`parent_id`)\n) ENGINE=InnoDB");
    expect(arsdb.stageName("users")).toBe("_rs_users");
    expect(arsdb.oldName("x".repeat(70)).length).toBe(64);
  });

  it("re-keys only what really decrypts with the source key", () => {
    const a = Buffer.alloc(32, 1);
    const b = Buffer.alloc(32, 2);
    const sealed = arsdb.encryptWith(Buffer.from("secret"), a);
    expect(arsdb.tryDecrypt(sealed, a)?.toString()).toBe("secret");
    expect(arsdb.tryDecrypt(sealed, b)).toBeNull();
    expect(arsdb.tryDecrypt("plain text value", a)).toBeNull();
  });

  it("keeps the newest scheduled packages on Drive and never touches others", () => {
    const files = ["ars-scheduled-20261120-010000.arsbak", "ars-scheduled-20261122-010000.arsbak", "ars-scheduled-20261121-010000.arsbak", "ars-full-20261101-010000.arsbak", "notes.txt"].map((name, index) => ({ id: String(index), name, size: 1, createdTime: "" }));
    expect(selectPackagesForDeletion(files, 2).map((file) => file.name)).toEqual(["ars-scheduled-20261120-010000.arsbak"]);
    expect(selectPackagesForDeletion(files, 0).length).toBe(2); // at least one is always kept
  });

  it("reads Drive's resumable answers (308 with a range, then the new file)", async () => {
    const answers = [new Response(null, { status: 308, headers: { range: "bytes=0-262143" } }), new Response(JSON.stringify({ id: "abc" }), { status: 200 })];
    const calls: RequestInit[] = [];
    const deps = { fetch: (async (_url: string, init: RequestInit) => (calls.push(init), answers.shift()!)) as unknown as typeof fetch };
    expect(await uploadPiece("https://upload", Buffer.alloc(262144), 0, 300000, deps)).toEqual({ next: 262144, id: null });
    expect(await uploadPiece("https://upload", Buffer.alloc(37856), 262144, 300000, deps)).toEqual({ next: 300000, id: "abc" });
    expect((calls[1]!.headers as Record<string, string>)["content-range"]).toBe("bytes 262144-299999/300000");
  });

  it("words alerts without secrets and says who did it", () => {
    const text = backupEventText("DOWNLOADED", "ars-full-20261123-101112.arsbak was downloaded.", "IT Admin");
    expect(text.title).toBe("A full backup was downloaded");
    expect(text.message).toContain("By IT Admin.");
  });

  it("guides the passphrase and sizes", () => {
    expect(passphraseHint("short").ok).toBe(false);
    expect(passphraseHint("a long enough phrase").ok).toBe(true);
    expect(passphraseHint("zzzzzzzzzzzzzz").ok).toBe(false);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
  });

  it("restores only in the known modes", async () => {
    await expect(engine.restoreStep({ file: "x", key: Buffer.alloc(32), connect: async () => { throw new Error("no"); }, uploadDir: ".", mode: "everything" as never, runId: 1 }, null)).rejects.toThrow(/Choose what to restore/);
  });
});
