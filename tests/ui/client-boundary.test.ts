import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// v1.85.2 (D-414): a server file must never call a plain function exported from
// a "use client" module. Next turns those exports into client references, so
// the call throws at render ("Attempted to call powerHref() from the server"),
// which broke Admin → Records → Tickets and Meetings on live (v1.85.0).
// Components (Capitalised) are fine to render; hooks (use…) and helpers are not.
const ROOTS = ["app", "features", "lib", "server"];
const read = (file: string) => fs.readFileSync(file, "utf8");
const isClient = (source: string) => /^\s*["']use client["']/.test(source);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name))
      out.push(full.split(path.sep).join("/"));
  }
  return out;
}

describe("client module boundary", () => {
  it("no server file imports a non-component function from a client module", () => {
    const files = ROOTS.flatMap((root) => walk(root));
    const clientExports = new Map<string, Set<string>>();
    for (const file of files) {
      const source = read(file);
      if (!isClient(source)) continue;
      const names = new Set<string>();
      for (const match of source.matchAll(
        /export (?:async )?function ([a-z]\w*)/g,
      ))
        names.add(match[1] ?? "");
      for (const match of source.matchAll(/export const ([a-z]\w*)\s*=/g))
        names.add(match[1] ?? "");
      // Re-exports from a client module become client references too.
      for (const match of source.matchAll(/export\s*\{([^}]*)\}\s*from/g))
        for (const part of (match[1] ?? "").split(",")) {
          const name =
            part
              .trim()
              .split(/\s+as\s+/)
              .pop() ?? "";
          if (/^[a-z]\w*$/.test(name)) names.add(name);
        }
      if (names.size) clientExports.set(file.replace(/\.tsx?$/, ""), names);
    }
    const problems: string[] = [];
    for (const file of files) {
      const source = read(file);
      if (isClient(source)) continue;
      for (const match of source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*["']@\/([^"']+)["']/g,
      )) {
        const target = match[2] ?? "";
        const names = clientExports.get(target);
        if (!names) continue;
        const used = (match[1] ?? "")
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part && !part.startsWith("type "))
          .map((part) => part.split(/\s+as\s+/)[0] ?? part);
        for (const name of used)
          if (names.has(name))
            problems.push(
              `${file} imports ${name} from client module @/${target}`,
            );
      }
    }
    expect(problems).toEqual([]);
  });
});
