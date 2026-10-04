import type { Page } from '@playwright/test'

/** Open secondary content through the same disclosure control as a keyboard user. */
export async function expandRehearsal(page: Page, name: RegExp): Promise<void> {
  const summary = page.locator('.rehearsal-panel summary').filter({ hasText: name }).first()
  await summary.waitFor({ state: 'visible' })
  if (!(await summary.evaluate((element) => element.parentElement?.hasAttribute('open'))))
    await summary.click()
}
