// Runs exactly five product checks per browser against npm start's production build; browser-free core tests have a separate configuration.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./frontend/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1920, height: 1080 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1920, height: 1080 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: "npm start",
    url: "http://localhost:5173",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
