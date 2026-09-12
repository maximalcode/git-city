import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.electron.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: { trace: 'retain-on-failure' },
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npx vite -c vite.preview.config.ts',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
