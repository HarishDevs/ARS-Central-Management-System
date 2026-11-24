import fs from "node:fs";
import path from "node:path";
import e2eSetup from "../e2e/global-setup";

// v1.89.0 stage 4 (D-426): a fresh database (real migrations and seeds, the e2e people) for
// every visual run; the fixed-title records are made by the spec's first test.
export default async function setup(): Promise<void> {
  fs.rmSync(path.join(process.env.UIQA_OUT ?? "audit/ui-qa/visual", "ids.json"), { force: true });
  await e2eSetup();
}
