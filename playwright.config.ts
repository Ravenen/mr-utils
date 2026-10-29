import { defineConfig } from "@playwright/test";

// E2E tests of the built extension (`pnpm build`) on mock GitLab pages. Chromium only: Playwright
// cannot load extensions into Firefox.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
});
