import { test, expect, type Page } from '@playwright/test'

async function mountReview(page: Page, count: number): Promise<void> {
  await page.goto('/')
  await page.evaluate(async (fileCount) => {
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
      id: 'scoped-review',
      repository: '/fixture',
      origin_worktree: '/fixture',
      repository_id: 'fixture-repository'
    }
    const revision = 'retained-review-revision'
    const scopeId = 'reference:refs/heads/topic'
    const entries = Array.from({ length: fileCount }, (_, index) => ({
      entryId: `entry-${index}`,
      change: 'modified',
      oldPath: index === 0 ? 'executable.sh' : `file-${index}.txt`,
      newPath: index === 0 ? 'executable.sh' : `file-${index}.txt`,
      old: {
        present: true,
        mode: index === 1 ? '120000' : index === 2 ? '160000' : '100644',
        objectId: 'a'.repeat(40)
      },
      new: {
        present: true,
        mode: index === 0 ? '100755' : index === 1 ? '120000' : index === 2 ? '160000' : '100644',
        objectId: (index === 0 ? 'a' : 'b').repeat(40)
      },
      binary: false,
      type: index === 0 ? 'mode' : index === 1 ? 'symlink' : index === 2 ? 'gitlink' : 'text',
      text: {
        changes: index === 0 ? 'mode-only' : 'available',
        before: 'available',
        after: 'available'
      },
      lines: { before: 1, after: 1, additions: index === 0 ? 0 : 1, deletions: index === 0 ? 0 : 1 }
    }))
    const endpoint = (commit: string) => ({ kind: 'commit', commit, provenance: 'original' })
    bridgeModule.setBridge({
      rehearsalReviewSummary: async () => ({
        identity,
        reviewRevision: revision,
        toolResultRevision: null,
        complete: false,
        afterAvailable: false,
        afterReason: 'Tracked carried-work snapshot is unavailable.',
        scopes: [
          {
            scopeId: 'tracked-worktree',
            kind: 'tracked-worktree',
            label: 'Tracked worktree',
            refAliases: [],
            before: endpoint('c'.repeat(40)),
            after: null,
            available: false,
            unavailableReason: 'Tracked carried-work snapshot is unavailable.'
          },
          {
            scopeId,
            kind: 'committed-reference',
            label: 'topic',
            refAliases: ['refs/heads/topic'],
            before: endpoint('c'.repeat(40)),
            after: endpoint('d'.repeat(40)),
            available: true
          }
        ],
        defaultScopeId: scopeId,
        notices: [
          'Only tracked work is included.',
          'Rename matching was bounded.',
          'Untracked files are excluded.'
        ],
        carried: null,
        changeMap: { [scopeId]: entries },
        replayWarnings: []
      }),
      rehearsalReviewFiles: async () => ({
        identity,
        reviewRevision: revision,
        scopeId,
        entries,
        nextCursor: null,
        total: entries.length,
        complete: true,
        filter: null
      }),
      rehearsalReviewFile: async (
        _identity: unknown,
        _revision: string,
        _scopeId: string,
        entryId: string,
        view: string
      ) => ({
        identity,
        reviewRevision: revision,
        scopeId,
        entryId,
        view,
        availability: entryId === 'entry-0' && view === 'changes' ? 'mode-only' : 'available',
        text: view === 'changes' ? null : `${view}: retained ${entryId}`,
        hunks: [],
        entry: entries.find((entry) => entry.entryId === entryId)
      })
    } as never)
    const host = document.createElement('section')
    host.className = 'rehearsal-panel'
    const body = document.createElement('div')
    body.className = 'rehearsal-body'
    host.append(body)
    document.body.append(host)
    ReactDomModule.default.createRoot(body).render(
      ReactModule.default.createElement(panelModule.default, {
        report: {
          ...identity,
          schema: 1,
          command: ['rebase', 'main'],
          checkout: { kind: 'branch', target: 'topic' },
          pre_state: {},
          lifecycle: 'kept',
          outcome: 'clean',
          conflicted: false,
          refs: [],
          conflicts: [],
          drift: [],
          drift_unexpected: false
        }
      })
    )
  }, count)
}

test('shows mode metadata and all scope notices, and enables a retained reference After independently', async ({
  page
}) => {
  await page.setViewportSize({ width: 960, height: 700 })
  await mountReview(page, 2)
  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  await expect(review.getByRole('option').filter({ hasText: 'executable.sh' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const content = review.locator('.rehearsal-review-content')
  await expect(content).toContainText('100644')
  await expect(content).toContainText('100755')
  await expect(content).not.toContainText('No text changes to show.')
  const disclosure = review.locator('summary').filter({ hasText: 'Review scope and limits' })
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(review.getByText('Only tracked work is included.', { exact: true })).toBeVisible()
  await expect(review.getByText('Rename matching was bounded.', { exact: true })).toBeVisible()
  await expect(review.getByText('Untracked files are excluded.', { exact: true })).toBeVisible()
  const after = content.getByRole('tab', { name: 'After', exact: true })
  await expect(after).toBeEnabled()
  await after.focus()
  await page.keyboard.press('Enter')
  await expect(content.locator('pre')).toHaveText('after: retained entry-0')
})

for (const width of [960, 1280]) {
  test(`keeps selected content visible when keyboard-selecting the end of a long list at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: width === 960 ? 700 : 800 })
    await mountReview(page, 200)
    const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
    const files = review.getByRole('listbox', { name: 'Changed files' })
    await expect(files.getByRole('option')).toHaveCount(200)
    const last = files.getByRole('option').last()
    await last.focus()
    await expect(last).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(last).toHaveAttribute('aria-selected', 'true')
    const content = review.locator('.rehearsal-review-content')
    await expect(
      content.getByRole('heading', { name: 'file-199.txt', exact: true })
    ).toBeInViewport()
    const before = content.getByRole('tab', { name: 'Before', exact: true })
    await expect(before).toBeInViewport()
    await before.focus()
    await expect(before).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(content.locator('pre')).toHaveText('before: retained entry-199')
    await expect(content.locator('pre')).toBeInViewport()
    const separator = review.getByRole('separator', { name: 'Resize file list' })
    const startWidth = Number(await separator.getAttribute('aria-valuenow'))
    await separator.focus()
    await expect(separator).toBeFocused()
    await page.keyboard.press(startWidth === 48 ? 'ArrowLeft' : 'ArrowRight')
    await expect(separator).toBeFocused()
    await expect(separator).toHaveAttribute(
      'aria-valuenow',
      String(startWidth === 48 ? 46 : startWidth + 2)
    )
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.screenshot({ path: `test-results/rehearsal-long-list-${width}.png` })
  })
}

test('identifies stored symbolic-link targets and submodule pointers as distinct content kinds', async ({
  page
}) => {
  await mountReview(page, 3)
  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  const content = review.locator('.rehearsal-review-content')
  await review.getByRole('option').filter({ hasText: 'file-1.txt' }).click()
  await expect(content).toContainText('Symbolic link target')
  await expect(content).toContainText('the target is not followed')
  await expect(content).toContainText('120000')
  await review.getByRole('tab', { name: 'After', exact: true }).click()
  await expect(content.locator('pre')).toHaveText('after: retained entry-1')
  await review.getByRole('option').filter({ hasText: 'file-2.txt' }).click()
  await expect(content).toContainText('Git submodule pointer')
  await expect(content).toContainText('recorded commits')
  await expect(content).toContainText('160000')
  await review.getByRole('tab', { name: 'Before', exact: true }).click()
  await expect(content.locator('pre')).toHaveText('before: retained entry-2')
})
