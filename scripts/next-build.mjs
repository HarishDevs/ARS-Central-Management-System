// v1.92.2 (D-445): run `next build` with more JavaScript heap.
// GoDaddy's Update Preview build stopped with "JavaScript heap out of memory"
// at Node's default limit (~1.5 GB). The compile alone needs 1.2-1.5 GB, so the
// build asks for 2.5 GB unless NODE_OPTIONS already sets a limit. Works on
// Windows and Linux (no shell-specific env syntax). Build workers inherit it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const HEAP_MB = 2560;
const current = process.env.NODE_OPTIONS ?? "";
const env = { ...process.env };
if (!/--max-old-space-size=/.test(current)) {
  env.NODE_OPTIONS = `${current} --max-old-space-size=${HEAP_MB}`.trim();
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "build", ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`next build stopped by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
