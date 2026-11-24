import { defineConfig, devices } from "@playwright/test";
import base, { E2E_ENV } from "./playwright.config";

// UI/UX QA audit (phase 1, docs/qa/QA_TEST_PLAN.md): a measuring run, not a
// pass/fail suite. It reuses the e2e production build, database helpers and
// seeded people, but:
//   - the server is started once outside Playwright (`npx next start`, same
//     E2E_ENV) and reused, so the route x viewport sweep can run in chunks;
//   - the database is (re)created only when UIQA_SETUP=1 (first chunk);
//   - Chromium, Microsoft Edge (channel "msedge", installed locally),
//     Firefox and WebKit (installed with the owner's approval).
// Run (example): UIQA=1 UIQA_SETUP=1 TEST_DB_NAME=ars_approvals_test_qa E2E_PORT=3270 E2E_MOCK_PORT=4171 \
//   npx playwright test -c playwright.ui-qa.config.ts --project=chromium tests/e2e/zz-ui-qa-audit.spec.ts
const PORT = Number(process.env.E2E_PORT ?? 3270);

export default defineConfig({
  ...base,
  testDir: "tests/e2e",
  testMatch: /zz-ui-qa-.*\.spec\.ts/,
  globalSetup: process.env.UIQA_SETUP === "1" ? "./tests/e2e/global-setup.ts" : undefined,
  timeout: 60 * 60_000,
  reporter: [["list"]],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: true,
    env: E2E_ENV,
  },
  use: { ...base.use, baseURL: `http://localhost:${PORT}`, trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
    // Installed with the owner's approval (23 Nov 2026): WebKit stands in for Safari.
    // v1.89.0 (D-424): E2E_FIREFOX_PATH, as in playwright.config.ts (Windows refuses the copy under %LOCALAPPDATA%).
    { name: "firefox", use: { ...devices["Desktop Firefox"], ...(process.env.E2E_FIREFOX_PATH ? { launchOptions: { executablePath: process.env.E2E_FIREFOX_PATH } } : {}) } },
    // WebKit upgrades http://localhost assets to https (HSTS / upgrade-insecure-requests of the production
    // headers); the specs route them back to http (webkitHttpsShim in tests/e2e/ui-qa-shared.ts).
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
