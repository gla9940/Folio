import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-pwa',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: 'chrome', viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure'},
  webServer: {command: 'npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false},
});
