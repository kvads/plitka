import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: process.env.PW_BASE_URL || "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    actionTimeout: 5000,
  },
  timeout: 15000,
  workers: 1,
});
