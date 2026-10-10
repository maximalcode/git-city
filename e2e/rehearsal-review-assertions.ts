import { expect, type Page } from '@playwright/test'

/** Read a retained result through the public bridge and its visible keyboard UI. */
export async function expectFrozenReview(
  page: Page,
  repo: string,
  path: string,
  before: string,
  after: string | null
): Promise<string> {
  const shownId = await page
    .getByText('Kept rehearsal:', { exact: false })
    .locator('code')
    .textContent()
  expect(shownId).toBeTruthy()
  const result = await page.evaluate(
    async ({ repo, shownId, path }) => {
      const listing = await window.gitCity.rehearsalList(repo)
      const identity = listing.entries.find((entry) => entry.id === shownId)
      if (!identity) throw new Error('The displayed rehearsal is not retained')
      const summary = await window.gitCity.rehearsalReviewSummary(identity)
      if (!summary.defaultScopeId) throw new Error('The displayed rehearsal has no review scope')
      const files = await window.gitCity.rehearsalReviewFiles(
        identity,
        summary.reviewRevision,
        summary.defaultScopeId
      )
      const entry = files.entries.find(
        (candidate) => candidate.newPath === path || candidate.oldPath === path
      )
      if (!entry) throw new Error('The expected file is missing from the frozen inventory')
      const contents = await Promise.all(
        (['before', 'after', 'changes'] as const).map((view) =>
          window.gitCity.rehearsalReviewFile(
            identity,
            summary.reviewRevision,
            summary.defaultScopeId!,
            entry.entryId,
            view
          )
        )
      )
      return { summary, files, contents }
    },
    { repo, shownId, path }
  )
  expect(result.summary.identity.id).toBe(shownId)
  expect(result.summary.complete).toBe(true)
  expect(result.summary.afterAvailable).toBe(true)
  for (const response of [result.files, ...result.contents]) {
    expect(response.identity).toEqual(result.summary.identity)
    expect(response.reviewRevision).toBe(result.summary.reviewRevision)
    expect(response.scopeId).toBe(result.summary.defaultScopeId)
  }
  expect(result.contents[0]).toMatchObject({ availability: 'available', text: before })
  expect(result.contents[1]).toMatchObject({
    availability: after === null ? 'absent' : 'available',
    text: after
  })

  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  const file = review.getByRole('option').filter({ hasText: path })
  await expect(file).toBeEnabled()
  await file.focus()
  await page.keyboard.press('Enter')
  for (const [view, expected] of [
    ['Before', before],
    ['After', after]
  ] as const) {
    await expect(review.getByRole('tab', { name: view, exact: true })).toBeEnabled()
    await review.getByRole('tab', { name: view, exact: true }).focus()
    await page.keyboard.press('Enter')
    if (expected === null) {
      await expect(review.locator('pre')).toHaveCount(0)
      await expect(review.getByText('This side is absent.', { exact: true })).toBeVisible()
    } else await expect(review.locator('pre')).toHaveText(expected)
  }
  await expect(review.getByRole('tab', { name: 'Changes', exact: true })).toBeEnabled()
  await review.getByRole('tab', { name: 'Changes', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(review.locator('.diff-del')).toContainText(before.trim())
  if (after !== null) await expect(review.locator('.diff-add')).toContainText(after.trim())
  return shownId!
}
