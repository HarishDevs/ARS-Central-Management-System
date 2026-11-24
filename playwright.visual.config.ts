import { defineConfig, devices } from "@playwright/test";
import base, { E2E_ENV } from "./playwright.config";

// v1.89.0 stage 4 (D-426): visual regression baselines (docs/qa/VISUAL_REGRESSION_REPORT.md).
// Never part of the normal e2e run: the spec skips unless VISUAL=1, and this config is separate.
// The server is the e2e production build started outside Playwright (or by webServer below)
// against its own throw-away database; VISUAL_SETUP=1 recreates that database and the
// fixed-title records first (do it on every run: the baselines assume a fresh database).
//   compare: VISUAL=1 VISUAL_SETUP=1 TEST_DB_NAME=ars_approvals_test_vr E2E_PORT=3283 E2E_MOCK_PORT=4184 \
//            npx playwright test -c playwright.visual.config.ts
//   update:  the same with --update-snapshots, only for a reviewed, intended change.
// Chromium is the baseline browser; VISUAL_BROWSERS=chromium,firefox,webkit adds the others
// (no Firefox / WebKit baselines are committed: see the report).
// The fixed-title records' ids (ui-qa-shared setUpRecords) stay apart from the UI QA sweep's.
process.env.UIQA_OUT ??= "audit/ui-qa/visual";
const PORT = Number(process.env.E2E_PORT ?? 3283);
const wanted = (process.env.VISUAL_BROWSERS ?? "chromium").split(",");
const firefox = { ...devices["Desktop Firefox"], ...(process.env.E2E_FIREFOX_PATH ? { launchOptions: { executablePath: process.env.E2E_FIREFOX_PATH } } : {}) };

export default defineConfig({
  ...base,
  testDir: "tests/visual",
  testMatch: /.*\.visual\.ts/,
  globalSetup: process.env.VISUAL_SETUP === "1" ? "./tests/visual/global-setup.ts" : undefined,
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  timeout: 120_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report/visual" }]],
  outputDir: process.env.VISUAL_OUTPUT ?? "test-results/visual",
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.2, animations: "disabled", caret: "hide", scale: "css" },
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 120_000,
    reuseExistingServer: true,
    env: E2E_ENV,
  },
  use: { ...base.use, baseURL: `http://localhost:${PORT}`, trace: "off", reducedMotion: "reduce", colorScheme: "light", locale: "en-IN", timezoneId: "Asia/Kolkata" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(wanted.includes("firefox") ? [{ name: "firefox", use: firefox }] : []),
    ...(wanted.includes("webkit") ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
});
