import { expect, test, type Page } from '@playwright/test'

async function mountFocusReview(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const reactUrl = resources.find((url) => url.includes('/.vite/deps/react.js'))
    const reactDomUrl = resources.find((url) => url.includes('/.vite/deps/react-dom_client.js'))
    if (!reactUrl || !reactDomUrl) throw new Error('React preview modules were not loaded')
    const [ReactModule, ReactDomModule, panelModule, bridgeModule] = await Promise.all([
      import(reactUrl),
      import(reactDomUrl),
      import('/src/panels/RehearsalReviewPanel.tsx'),
      import('/src/lib/bridge.ts')
    ])
    const identity = {
      id: 'focus-review',
      repository: '/focus/repo',
      repository_id: 'focus-repository',
      origin_worktree: '/focus/repo'
    }
    const trackedScope = 'tracked-worktree'
    const topicScope = 'reference:refs/heads/topic'
    const endpoint = (commit: string) => ({
      kind: 'commit' as const,
      commit,
      provenance: 'original' as const
    })
    const entry = (entryId: string, path: string) => ({
      entryId,
      change: 'modified' as const,
      oldPath: path,
      newPath: path,
      old: { present: true, mode: '100644', objectId: `${entryId}-before` },
      new: { present: true, mode: '100644', objectId: `${entryId}-after` },
      binary: false,
      type: 'text' as const,
      rename: 'not-detected' as const,
      text: {
        changes: 'available' as const,
        before: 'available' as const,
        after: 'available' as const
      },
      lines: { before: 1, after: 1, additions: 1, deletions: 1 }
    })
    const trackedEntry = entry('tracked-entry', 'tracked.txt')
    const topicEntry = entry('topic-entry', 'topic.txt')
    let delayNextFile = false
    let delayedFile: (() => void) | null = null
    const sourceEntries = (scopeId: string) =>
      scopeId === topicScope ? [topicEntry] : [trackedEntry]
    const api = {
      rehearsalReviewSummary: async (request: typeof identity) => ({
        identity: request,
        reviewRevision: 'focus-revision',
        toolResultRevision: null,
        complete: true,
        afterAvailable: true,
        afterReason: null,
        scopes: [
          {
            scopeId: trackedScope,
            kind: 'tracked-worktree' as const,
            label: 'Current worktree',
            refAliases: [],
            before: endpoint('a'.repeat(40)),
            after: endpoint('b'.repeat(40)),
            available: true
          },
          {
            scopeId: topicScope,
            kind: 'committed-reference' as const,
            label: 'topic',
            refAliases: ['refs/heads/topic'],
            before: endpoint('c'.repeat(40)),
            after: endpoint('d'.repeat(40)),
            available: true
          }
        ],
        defaultScopeId: trackedScope,
        notices: [],
        replayWarnings: [],
        carried: null,
        changeMap: { [trackedScope]: [trackedEntry], [topicScope]: [topicEntry] }
      }),
      rehearsalReviewFiles: async (
        request: typeof identity,
        revision: string,
        scopeId: string,
        _cursor?: string,
        filter?: string
      ) => {
        const entries = sourceEntries(scopeId).filter((candidate) =>
          `${candidate.oldPath}\n${candidate.newPath}`.includes(filter ?? '')
        )
        return {
          identity: request,
          reviewRevision: revision,
          scopeId,
          entries,
          nextCursor: null,
          total: entries.length,
          complete: true,
          filter: filter || null
        }
      },
      rehearsalReviewFile: async (
        request: typeof identity,
        revision: string,
        scopeId: string,
        entryId: string,
        view: 'changes' | 'before' | 'after'
      ) => {
        const selected = sourceEntries(scopeId).find((candidate) => candidate.entryId === entryId)
        if (!selected) throw new Error('Unknown focus fixture entry')
        const result = {
          identity: request,
          reviewRevision: revision,
          scopeId,
          entryId,
          view,
          availability: 'available' as const,
          text: `${selected.newPath}:${view}`,
          hunks: [],
          entry: selected
        }
        if (delayNextFile) {
          delayNextFile = false
          return new Promise<typeof result>((resolve) => {
            delayedFile = () => resolve(result)
          })
        }
        return result
      }
    }
    bridgeModule.setBridge(api as never)
    const report = {
      ...identity,
      schema: 1 as const,
      sandbox: '/focus/sandbox',
      command: ['merge', 'topic'],
      checkout: { kind: 'branch' as const, target: 'main' },
      pre_state: {},
      lifecycle: 'kept' as const,
      outcome: 'clean' as const,
      conflicted: false,
      refs: [],
      conflicts: [],
      drift: [],
      drift_unexpected: false
    }
    const host = document.createElement('div')
    host.id = 'rehearsal-focus-harness'
    document.body.append(host)
    ReactDomModule.default.createRoot(host).render(
      ReactModule.default.createElement(panelModule.default, {
        report
      })
    )
    ;(
      window as unknown as {
        reviewFocusFixture: { delayNextFile: () => void; resolveDelayedFile: () => void }
      }
    ).reviewFocusFixture = {
      delayNextFile: () => {
        delayNextFile = true
      },
      resolveDelayedFile: () => {
        const resolve = delayedFile
        delayedFile = null
        resolve?.()
      }
    }
  })
}

test('keeps owned review focus stable across delayed content and scope reads', async ({ page }) => {
  await mountFocusReview(page)
  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  const content = review.locator('.rehearsal-review-content')
  await expect(content.locator('pre')).toHaveText('tracked.txt:changes')

  const before = content.getByRole('tab', { name: 'Before', exact: true })
  await page.evaluate(() => {
    ;(
      window as unknown as { reviewFocusFixture: { delayNextFile: () => void } }
    ).reviewFocusFixture.delayNextFile()
  })
  await before.click()
  await expect(before).toBeFocused()
  await expect(content.locator('pre')).toHaveCount(0)

  await page.evaluate(() => {
    const outside = document.createElement('input')
    outside.id = 'review-focus-outside'
    document.body.append(outside)
    outside.focus()
  })
  await expect(page.locator('#review-focus-outside')).toBeFocused()
  await page.evaluate(() => {
    ;(
      window as unknown as { reviewFocusFixture: { resolveDelayedFile: () => void } }
    ).reviewFocusFixture.resolveDelayedFile()
  })
  await expect(content.locator('pre')).toHaveText('tracked.txt:before')
  await expect(page.locator('#review-focus-outside')).toBeFocused()

  await page.evaluate(() => {
    ;(
      window as unknown as { reviewFocusFixture: { delayNextFile: () => void } }
    ).reviewFocusFixture.delayNextFile()
  })
  await content.getByRole('tab', { name: 'Changes', exact: true }).click()
  const scope = review.getByRole('combobox', { name: 'Review scope' })
  await scope.focus()
  await page.keyboard.press('t')
  await expect(scope).toHaveValue('reference:refs/heads/topic')
  await expect(scope).toBeFocused()
  await expect(content.locator('pre')).toHaveText('topic.txt:changes')
  await page.evaluate(() => {
    ;(
      window as unknown as { reviewFocusFixture: { resolveDelayedFile: () => void } }
    ).reviewFocusFixture.resolveDelayedFile()
  })
  await expect(content.locator('pre')).toHaveText('topic.txt:changes')
})
