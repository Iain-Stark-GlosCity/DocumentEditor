import { defineConfig } from "@playwright/test";

/**
 * End-to-end smoke tests against the production build, served by `vite preview`. Without Tauri
 * the app runs on its in-memory platform with a sample document. `npm run test:e2e` builds first.
 */
const PORT = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    viewport: { width: 1300, height: 800 },
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
