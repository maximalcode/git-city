import { expect, test, type Page } from '@playwright/test'

async function mountApplyPanel(page: Page, strictCapability: boolean): Promise<void> {
  await page.goto('/')
  await page.evaluate(async (strict) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const reactUrl = resources.find((url) => url.includes('/.vite/deps/react.js'))
    const reactDomUrl = resources.find((url) => url.includes('/.vite/deps/react-dom_client.js'))
    if (!reactUrl || !reactDomUrl) throw new Error('React preview modules were not loaded')
    const [ReactModule, ReactDomModule, panelModule, bridgeModule, storeModule] = await Promise.all(
      [
        import(reactUrl),
        import(reactDomUrl),
        import('/src/panels/RehearsalPanel.tsx'),
        import('/src/lib/bridge.ts'),
        import('/src/store.ts')
      ]
    )
    const identity = {
      id: 'apply-review',
      repository: '/apply/repo',
      origin_worktree: '/apply/repo',
      repository_id: '/apply/repo/.git'
    }
    const revision = 'review-revision-1'
    const resultRevision = strict ? 'tool-result-revision-1' : undefined
    const report = {
      ...identity,
      schema: 1 as const,
      command: ['merge', 'topic'],
      checkout: { kind: 'branch' as const, target: 'main' },
      pre_state: {},
      lifecycle: 'kept' as const,
      can_apply: true,
      result_revision: resultRevision,
      outcome: 'clean' as const,
      conflicted: false,
      refs: [{ name: 'refs/heads/main', before: 'before-main', after: 'after-main' }],
      conflicts: [],
      drift: [],
      drift_unexpected: false
    }
    const changedEntry = {
      entryId: 'changed-file',
      change: 'modified' as const,
      oldPath: 'src/value.ts',
      newPath: 'src/value.ts',
      old: { present: true, mode: '100644', objectId: 'old-object' },
      new: { present: true, mode: '100644', objectId: 'new-object' },
      binary: false,
      type: 'text' as const,
      text: {
        changes: 'available' as const,
        before: 'available' as const,
        after: 'available' as const
      },
      lines: { before: 1, after: 1, additions: 1, deletions: 1 }
    }
    const summary = {
      identity,
      reviewRevision: revision,
      toolResultRevision: resultRevision ?? null,
      complete: true,
      afterAvailable: true,
      afterReason: null,
      scopes: [
        {
          scopeId: 'tracked-worktree',
          kind: 'tracked-worktree' as const,
          label: 'Current worktree',
          refAliases: [],
          before: { kind: 'commit' as const, commit: 'before', provenance: 'original' as const },
          after: { kind: 'commit' as const, commit: 'after', provenance: 'original' as const },
          available: true
        }
      ],
      defaultScopeId: 'tracked-worktree',
      notices: [],
      replayWarnings: [],
      carried: null,
      changeMap: { 'tracked-worktree': [changedEntry] }
    }
    const files = {
      identity,
      reviewRevision: revision,
      scopeId: 'tracked-worktree',
      entries: [changedEntry],
      nextCursor: null,
      total: 1,
      complete: true,
      filter: null
    }
    let workingStatus = {
      branch: 'main',
      detachedAt: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [
        {
          path: 'src/value.ts',
          origPath: undefined,
          index: 'modified',
          worktree: 'unmodified',
          conflicted: false
        },
        {
          path: 'scratch.txt',
          origPath: undefined,
          index: 'untracked',
          worktree: 'untracked',
          conflicted: false
        }
      ],
      opState: 'none' as const,
      stashCount: 0,
      remotes: [],
      headHash: 'initial-head'
    }
    let applyCalls = 0
    const recovery = {
      state: 'none' as const,
      repository: identity.repository,
      can_complete: false,
      can_rollback: false,
      message: ''
    }
    bridgeModule.setBridge({
      rehearsalAvailability: async () => ({ available: true, configured: true, message: '' }),
      rehearsalRecovery: async () => recovery,
      rehearsalReviewSummary: async () => summary,
      rehearsalReviewFiles: async () => files,
      rehearsalReviewFile: async (
        _identity: unknown,
        requestRevision: string,
        scopeId: string,
        entryId: string,
        view: string
      ) => ({
        identity,
        reviewRevision: requestRevision,
        scopeId,
        entryId,
        view,
        availability: 'available' as const,
        text: 'const value = 1',
        hunks: [],
        entry: changedEntry
      }),
      rehearsalUndoStatus: async () => ({
        repository: identity.repository,
        rehearsal: null,
        worktree: null,
        applied_at_unix: null,
        available: false,
        reason: 'No Apply to undo.'
      }),
      rehearsalList: async () => ({
        repository: identity.repository,
        entries: [],
        bytes: 0,
        freeBytes: null,
        lowSpace: false,
        protected: false
      }),
      rehearsalApply: async () => {
        applyCalls++
        return { kind: 'applied' as const, message: 'Applied.', recovery }
      },
      status: async () => workingStatus
    } as never)
    const store = storeModule.useStore
    store.setState({
      repoPath: identity.repository,
      workingStatus,
      rehearsalOpen: true,
      rehearsalConfigured: true,
      rehearsalModeSetting: { repository: identity.repository, mode: 'ask' as const },
      rehearsalBusy: false,
      rehearsalResults: { [identity.repository]: { kind: 'report' as const, report } },
      rehearsalRecovery: { [identity.repository]: recovery },
      rehearsalApplications: {}
    })
    document.getElementById('root')?.replaceChildren()
    const host = document.createElement('div')
    host.id = 'apply-confirmation-harness'
    document.body.append(host)
    ReactDomModule.default
      .createRoot(host)
      .render(ReactModule.default.createElement(panelModule.default))
    await new Promise((resolve) => setTimeout(resolve, 100))
    store.setState({
      repoPath: identity.repository,
      workingStatus,
      rehearsalOpen: true,
      rehearsalConfigured: true,
      rehearsalModeSetting: { repository: identity.repository, mode: 'ask' as const },
      rehearsalBusy: false,
      rehearsalResults: { [identity.repository]: { kind: 'report' as const, report } },
      rehearsalRecovery: { [identity.repository]: recovery },
      rehearsalApplications: {}
    })
    ;(
      window as unknown as {
        applyHarness: {
          store: typeof store
          setWorkingStatus: (status: typeof workingStatus) => void
          applyCalls: () => number
        }
      }
    ).applyHarness = {
      store,
      setWorkingStatus: (nextStatus) => {
        workingStatus = nextStatus
      },
      applyCalls: () => applyCalls
    }
  }, strictCapability)
}

test('confirmation is tied to the displayed review and refreshes checkout status before Apply', async ({
  page
}) => {
  await mountApplyPanel(page, true)
  const panel = page.locator('#apply-confirmation-harness .rehearsal-panel')
  const apply = panel.getByRole('button', { name: 'Apply', exact: true })
  await expect(apply).toBeEnabled()
  await apply.click()
  const dialog = page.getByRole('dialog', { name: 'Confirm Apply' })
  await expect(dialog).toContainText('review-revision-1')
  await expect(dialog).toContainText('refs/heads/main')

  await page.evaluate(() => {
    const harness = (
      window as unknown as { applyHarness: { setWorkingStatus: (status: any) => void } }
    ).applyHarness
    harness.setWorkingStatus({
      branch: 'main',
      detachedAt: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [
        {
          path: 'external.txt',
          origPath: undefined,
          index: 'untracked',
          worktree: 'untracked',
          conflicted: false
        }
      ],
      opState: 'none',
      stashCount: 0,
      remotes: [],
      headHash: 'initial-head'
    })
  })
  await dialog.getByRole('button', { name: 'Apply rehearsal' }).click()
  await expect(dialog).toBeHidden()
  await expect(panel.getByTestId('apply-confirmation-invalidated')).toContainText(
    'checkout state changed'
  )
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { applyHarness: { applyCalls: () => number } }
      ).applyHarness.applyCalls()
    )
  ).toBe(0)
})

test('refreshing the same retained result invalidates an open confirmation immediately', async ({
  page
}) => {
  await mountApplyPanel(page, true)
  const panel = page.locator('#apply-confirmation-harness .rehearsal-panel')
  await panel.getByRole('button', { name: 'Apply', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm Apply' })
  await expect(dialog).toContainText('review-revision-1')

  await panel.getByRole('button', { name: 'Refresh review' }).evaluate((button) => button.click())
  await expect(dialog).toBeHidden()
  await expect(panel.getByTestId('apply-confirmation-invalidated')).toContainText(
    'reviewed result or checkout state changed'
  )
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { applyHarness: { applyCalls: () => number } }
      ).applyHarness.applyCalls()
    )
  ).toBe(0)
})

test('missing expected-result capability gives a clear refusal and disables Apply', async ({
  page
}) => {
  await mountApplyPanel(page, false)
  const panel = page.locator('#apply-confirmation-harness .rehearsal-panel')
  await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  await expect(panel).toContainText('did not provide the matching expected-result revision')
})
