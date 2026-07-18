import { defineConfig, devices } from '@playwright/test'

/**
 * Renderer end-to-end tests. These drive the REAL 3D app (via the browser
 * preview with ?mock data) to catch things unit tests structurally cannot —
 * e.g. a view-mode switch freezing the render loop. Chromium background
 * throttling is disabled so the requestAnimationFrame loop keeps running and
 * a freeze is observable as "draw calls stop advancing".
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5199',
    headless: true,
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
      ]
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite -c vite.preview.config.ts',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000
  }
})
