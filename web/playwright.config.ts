import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: {
    baseURL: process.env.SYRAVEC_TEST_BASE_URL || "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
      args: ["--no-sandbox"],
    },
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
