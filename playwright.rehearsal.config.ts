import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.electron.ts',
  timeout: 300_000,
  expect: { timeout: 90_000 },
  use: { actionTimeout: 90_000, trace: 'retain-on-failure' },
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npx vite -c vite.preview.config.ts',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
