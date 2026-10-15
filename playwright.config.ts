import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/api/lab",
    reuseExistingServer: false,
    timeout: 90000,
    env: {
      NEXT_DIST_DIR: ".next-browser-tests",
      DATABASE_PATH: "./data/browser-test.sqlite",
      OPENAI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      FAST_PROVIDER: "google",
      FAST_MODEL: "gemini-2.5-flash",
      BALANCED_PROVIDER: "google",
      BALANCED_MODEL: "gemini-2.5-flash",
      ADVANCED_PROVIDER: "google",
      ADVANCED_MODEL: "gemini-2.5-pro",
      ENABLE_BROWSER_TOOLS: "true",
      APP_BASE_URL: "http://127.0.0.1:3100",
    },
  },
});
