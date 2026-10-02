// Configures the five eventual product checks against production; pure core tests do not use browsers.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./frontend/e2e",
  testMatch: "**/*.spec.ts",
  use: { baseURL: "http://localhost:5173" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "npm start",
    url: "http://localhost:5173",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
