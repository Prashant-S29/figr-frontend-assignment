// Configures browser-free core tests; product end-to-end checks use a separate configuration.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./frontend/tests",
  testMatch: "**/*.test.ts",
});
