import { test, expect, type Page } from '@playwright/test'

/** Mount the review workspace against the public preload-shaped bridge. */
async function mountReview(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __gitCityMock?: unknown }).__gitCityMock)
  )
  await page.evaluate(async () => {
    const identity = {
      id: 'review-1',
      repository: '/repo',
      repository_id: 'repo-id',
      origin_worktree: '/repo'
    }
    const entries = Array.from({ length: 201 }, (_, index) => {
      const path = `file-${String(index).padStart(3, '0')}.txt`
      return {
        entryId: `entry-${index}`,
        change: 'modified' as const,
        oldPath: path,
        newPath: path,
        old: { present: true, mode: '100644', objectId: `before-${index}` },
        new: { present: true, mode: '100644', objectId: `after-${index}` },
        binary: false,
        type: 'text' as const,
        rename: 'not-applicable' as const,
        text: {
          changes: 'available' as const,
          before: 'available' as const,
          after: 'available' as const
        },
        lines: { before: 1, after: 1, additions: 1, deletions: 1 }
      }
    })
    const calls = { summary: 0, files: 0, file: 0 }
    let revision = 'revision-1'
    let unavailable = false
    let delayNextFile = false
    let delayedFile: ((value: unknown) => void) | null = null
    const api = {
      rehearsalReviewSummary: async (request: typeof identity) => {
        calls.summary++
        if (unavailable) throw new Error('Retained review object is unavailable.')
        return {
          identity: request,
          reviewRevision: revision,
          toolResultRevision: revision,
          complete: true,
          afterAvailable: true,
          afterReason: null,
          scopes: [
            {
              scopeId: 'tracked-worktree',
              kind: 'tracked-worktree' as const,
              label: 'Current worktree',
              refAliases: [],
              before: { kind: 'commit' as const, commit: 'base', provenance: 'original' as const },
              after: { kind: 'commit' as const, commit: 'after', provenance: 'original' as const },
              available: true
            }
          ],
          defaultScopeId: 'tracked-worktree',
          notices: ['Fixture review'],
          replayWarnings: [],
          carried: null
        }
      },
      rehearsalReviewFiles: async (
        request: typeof identity,
        requestRevision: string,
        scopeId: string,
        cursor?: string,
        filter?: string
      ) => {
        calls.files++
        const page = cursor ? 1 : 0
        const pageEntries = entries.slice(page * 200, page * 200 + 200)
        return {
          identity: request,
          reviewRevision: requestRevision,
          scopeId,
          entries: pageEntries,
          nextCursor: page === 0 ? 'page-2' : null,
          total: filter ? pageEntries.length : entries.length,
          complete: true,
          filter: filter || null
        }
      },
      rehearsalReviewFile: async (
        request: typeof identity,
        requestRevision: string,
        scopeId: string,
        entryId: string,
        view: 'changes' | 'before' | 'after'
      ) => {
        calls.file++
        const entry = entries.find((candidate) => candidate.entryId === entryId) ?? entries[0]
        if (delayNextFile) {
          delayNextFile = false
          return new Promise((resolve) => {
            delayedFile = resolve
          })
        }
        return {
          identity: request,
          reviewRevision: requestRevision,
          scopeId,
          entryId,
          view,
          availability: 'available' as const,
          text: `${entry.newPath}:${view}:${requestRevision}`,
          hunks: [],
          entry
        }
      },
      rehearsalAvailability: async () => ({ available: true, configured: true, message: '' }),
      rehearsalRecovery: async () => ({
        state: 'none' as const,
        repository: '/repo',
        can_complete: false,
        can_rollback: false,
        message: ''
      })
    }
    ;(window as unknown as { gitCity: unknown }).gitCity = api
    const store = (window as unknown as { __gitCityMock: { store: any } }).__gitCityMock.store
    const report = {
      ...identity,
      schema: 1 as const,
      sandbox: '/sandbox',
      command: ['merge', 'topic'],
      checkout: { kind: 'branch' as const, target: 'main' },
      pre_state: {},
      lifecycle: 'kept' as const,
      can_apply: true,
      outcome: 'clean' as const,
      conflicted: false,
      refs: [],
      conflicts: [],
      drift: [],
      drift_unexpected: false
    }
    const render = (nextReport: typeof report): void => {
      store.setState({
        repoPath: '/repo',
        rehearsalOpen: true,
        rehearsalConfigured: true,
        rehearsalModeSetting: { repository: '/repo', mode: 'ask' },
        rehearsalResults: { '/repo': { kind: 'report', report: nextReport } }
      })
    }
    render(report)
    ;(window as unknown as { reviewFixture: unknown }).reviewFixture = {
      calls,
      entries,
      report,
      render,
      setRevision: (next: string) => (revision = next),
      setUnavailable: (next: boolean) => (unavailable = next),
      delayNextFile: () => (delayNextFile = true),
      resolveDelayedFile: (value: unknown) => {
        const resolver = delayedFile
        delayedFile = null
        resolver?.(value)
      }
    }
  })
}

const fixture = (page: Page): Promise<any> =>
  page.evaluate(() => (window as unknown as { reviewFixture: unknown }).reviewFixture)

test('refresh refetches loaded pages and preserves a page-two selection and view', async ({
  page
}) => {
  await mountReview(page)
  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  const files = review.locator('.rehearsal-review-files')
  await expect(files.getByRole('option')).toHaveCount(200)
  await review.getByRole('button', { name: 'Load more files' }).click()
  await expect(files.getByRole('option')).toHaveCount(201)

  const selected = review.getByRole('option', { name: /file-200\.txt/ })
  await selected.click()
  await review.getByRole('tab', { name: 'After', exact: true }).click()
  await expect(review.locator('pre')).toHaveText('file-200.txt:after:revision-1')
  const before = await fixture(page)

  await page.evaluate(() => {
    const state = (window as unknown as { reviewFixture: any }).reviewFixture
    state.render({ ...state.report })
  })
  await expect(review.locator('pre')).toHaveText('file-200.txt:after:revision-1')
  const after = await fixture(page)
  expect(after.calls.summary).toBeGreaterThan(before.calls.summary)
  expect(after.calls.files).toBeGreaterThan(before.calls.files)
  expect(after.calls.file).toBeGreaterThan(before.calls.file)
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(review.getByRole('tab', { name: 'After', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

test('refresh hides old content when the retained object becomes unavailable', async ({ page }) => {
  await mountReview(page)
  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  await expect(review.locator('.rehearsal-review-files').getByRole('option')).toHaveCount(200)
  await review.getByRole('option', { name: /file-000\.txt/ }).click()
  await review.getByRole('tab', { name: 'After', exact: true }).click()
  await expect(review.locator('pre')).toHaveText(/file-000\.txt:after/)

  await page.evaluate(() => {
    const state = (window as unknown as { reviewFixture: any }).reviewFixture
    state.setUnavailable(true)
    state.render({ ...state.report })
  })
  await expect(review.locator('pre')).toHaveCount(0)
  await expect(review.getByRole('alert')).toContainText('Retained review object is unavailable.')
})

test('late content from an older revision cannot replace the current revision', async ({
  page
}) => {
  await mountReview(page)
  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  await expect(review.locator('.rehearsal-review-files').getByRole('option')).toHaveCount(200)
  await review.getByRole('option', { name: /file-000\.txt/ }).click()
  await review.getByRole('tab', { name: 'After', exact: true }).click()
  await expect(review.locator('pre')).toHaveText('file-000.txt:after:revision-1')

  await page.evaluate(() => {
    const state = (window as unknown as { reviewFixture: any }).reviewFixture
    state.delayNextFile()
  })
  await review.getByRole('option', { name: /file-001\.txt/ }).click()
  await page.evaluate(() => {
    const state = (window as unknown as { reviewFixture: any }).reviewFixture
    state.setRevision('revision-2')
    state.render({ ...state.report, id: 'review-2' })
  })
  await expect(review.locator('pre')).toHaveCount(0)
  await expect(review.locator('.rehearsal-review-files').getByRole('option')).toHaveCount(200)
  await review.getByRole('option', { name: /file-000\.txt/ }).click()
  await review.getByRole('tab', { name: 'After', exact: true }).click()
  await expect(review.locator('pre')).toHaveText('file-000.txt:after:revision-2')
  await page.evaluate(() => {
    const state = (window as unknown as { reviewFixture: any }).reviewFixture
    state.resolveDelayedFile({})
  })
  await expect(review.locator('pre')).toHaveText('file-000.txt:after:revision-2')
})
