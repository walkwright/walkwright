import { defineConfig, devices } from "@playwright/test";
import { walk } from "walkwright/config";

/** where the walk finds the app */
const appUrl = process.env["APP_URL"] ?? "http://localhost:4173";

const use = {
  ...devices["Desktop Chrome"],
  baseURL: appUrl,
  viewport: { width: 1280, height: 800 },
  screenshot: "only-on-failure",
  trace: "retain-on-failure",
  ...walk.use,
} as const;

export default defineConfig({
  testDir: "./src/walk",
  outputDir: "./test-results",
  fullyParallel: true,
  timeout: 5 * 60_000,
  reporter: [["list"], ...walk.reporter({ appUrl })],

  projects: [
    { name: "walk account", testMatch: /\.setup\.ts$/, use },
    {
      name: "walk",
      testMatch: /\.walk\.ts$/,
      dependencies: ["walk account"],
      use,
    },
  ],
});
