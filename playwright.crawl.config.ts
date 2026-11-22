import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// v1.74.1 (D-397): the live click-through of every screen (tests/e2e/v1730-crawl.spec.ts)
// on its own: npx playwright test -c playwright.crawl.config.ts
// CRAWL_FULL=1 runs light and dark at 1366, 768 and 375 px; CRAWL_REUSE=1 uses a server already
// running on E2E_PORT (built with the same E2E settings) instead of building again.
const server = Array.isArray(base.webServer) ? base.webServer[0]! : base.webServer!;
export default defineConfig({
  ...base,
  testMatch: /v1730-crawl\.spec\.ts$/,
  timeout: 3_600_000,
  webServer: { ...server, reuseExistingServer: Boolean(process.env.CRAWL_REUSE) },
});
