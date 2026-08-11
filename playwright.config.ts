import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:3000/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      STSDLE_HOST: "127.0.0.1",
      STSDLE_PORT: "3000",
      STSDLE_DATA_DIR: ".tmp/e2e-var",
      STSDLE_SKIP_SYNC: "1",
      SPIRE_CODEX_BASE_URL: "https://fixture.test",
      STSDLE_FULL_CARD_ALLOWED_ORIGINS: "https://cdn.test",
    },
  },
});
