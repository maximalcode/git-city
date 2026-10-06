import { expect } from '@playwright/test'

/** Wait for the renderer's explicit success result after confirmed Apply. */
export async function waitForPackagedApply(page) {
  await expect
    .poll(() => page.getByText('The checked rehearsal was applied.', { exact: true }).isVisible(), {
      timeout: 300_000,
      message: 'Waiting for confirmed Apply to finish'
    })
    .toBe(true)
}
