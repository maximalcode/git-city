import { expect, test } from '@playwright/test'

function report(id: string, outcome: 'clean' | 'stopped') {
  return {
    id,
    repository: '/focus/repo',
    origin_worktree: '/focus/repo',
    repository_id: 'focus-repository',
    schema: 1 as const,
    command: ['merge', 'topic'],
    checkout: { kind: 'branch' as const, target: 'main' },
    pre_state: {},
    lifecycle: 'kept' as const,
    outcome,
    conflicted: false,
    refs: [],
    conflicts: [],
    drift: [],
    drift_unexpected: false
  }
}

test('restores panel focus when a continued child workflow unmounts', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
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
      id: 'stopped-preview',
      repository: '/focus/repo',
      origin_worktree: '/focus/repo',
      repository_id: 'focus-repository'
    }
    const stopped = {
      ...identity,
      schema: 1 as const,
      command: ['merge', 'topic'],
      checkout: { kind: 'branch' as const, target: 'main' },
      pre_state: {},
      lifecycle: 'kept' as const,
      outcome: 'stopped' as const,
      conflicted: false,
      refs: [],
      conflicts: [],
      drift: [],
      drift_unexpected: false
    }
    const continued = { ...stopped, id: 'continued-preview', outcome: 'clean' as const }
    const endpoint = {
      kind: 'commit' as const,
      commit: 'a'.repeat(40),
      provenance: 'original' as const
    }
    const summary = {
      identity,
      reviewRevision: 'focus-revision',
      toolResultRevision: null,
      complete: true,
      afterAvailable: true,
      afterReason: null,
      scopes: [
        {
          scopeId: 'tracked-worktree',
          kind: 'tracked-worktree' as const,
          label: 'Tracked worktree',
          refAliases: [],
          before: endpoint,
          after: endpoint,
          available: true
        }
      ],
      defaultScopeId: 'tracked-worktree',
      notices: [],
      replayWarnings: [],
      carried: null,
      changeMap: { 'tracked-worktree': [] }
    }
    const inventory = {
      repository: identity.repository,
      entries: [
        {
          ...identity,
          command: stopped.command,
          checkout: stopped.checkout,
          pre_state: {},
          created_unix: 0,
          execution: 'stopped' as const,
          lifecycle: 'kept' as const,
          active: false,
          stale: false,
          bytes: null,
          freeBytes: null
        }
      ],
      bytes: null,
      freeBytes: null,
      lowSpace: false,
      protected: false
    }
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
      rehearsalList: async () => inventory,
      rehearsalDraftList: async () => ({ status: 'saved' as const, records: [] }),
      rehearsalReviewSummary: async () => summary,
      rehearsalReviewFiles: async () => ({
        identity,
        reviewRevision: summary.reviewRevision,
        scopeId: 'tracked-worktree',
        entries: [],
        nextCursor: null,
        total: 0,
        complete: true,
        filter: null
      }),
      rehearsalContinue: async () => ({ kind: 'report' as const, report: continued })
    } as never)
    const store = storeModule.useStore
    store.setState({
      repoPath: identity.repository,
      rehearsalOpen: true,
      rehearsalConfigured: true,
      rehearsalModeSetting: { repository: identity.repository, mode: 'automatic' as const },
      rehearsalBusy: false,
      rehearsalResults: { [identity.repository]: { kind: 'report' as const, report: stopped } },
      rehearsalRecovery: { [identity.repository]: recovery },
      rehearsalInventories: { [identity.repository]: inventory }
    })
    document.getElementById('root')?.replaceChildren()
    const host = document.createElement('div')
    host.id = 'rehearsal-focus-harness'
    document.body.append(host)
    ReactDomModule.default
      .createRoot(host)
      .render(ReactModule.default.createElement(panelModule.default))
    ;(
      window as unknown as { focusHarness: { store: typeof store; continued: unknown } }
    ).focusHarness = {
      store,
      continued
    }
  })

  const harness = page.locator('#rehearsal-focus-harness')
  const panel = harness.locator('.rehearsal-panel')
  const continueButton = panel.getByRole('button', { name: 'Continue rehearsal' })
  const status = panel.locator('[aria-live="polite"]')
  await expect(continueButton).toBeEnabled()
  await continueButton.focus()
  await expect(continueButton).toBeFocused()
  await continueButton.click()
  await expect(continueButton).toHaveCount(0)
  await expect(status).toBeFocused()

  await page.evaluate(() => {
    const outside = document.createElement('input')
    outside.id = 'focus-harness-outside'
    document.body.append(outside)
    outside.focus()
    const canvas = document.createElement('canvas')
    canvas.id = 'focus-harness-canvas'
    document.body.append(canvas)
    canvas.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    const harness = (
      window as unknown as {
        focusHarness: { store: { setState: (state: unknown) => void }; continued: unknown }
      }
    ).focusHarness
    harness.store.setState({
      rehearsalResults: {
        '/focus/repo': {
          kind: 'report',
          report: { ...(harness.continued as Record<string, unknown>), id: 'continued-preview-2' }
        }
      }
    })
  })
  await expect(page.locator('#focus-harness-outside')).toBeFocused()
  await expect(status).not.toBeFocused()

  const keep = panel.getByRole('button', { name: 'Keep for later' })
  await keep.focus()
  await expect(keep).toBeFocused()
  await page.evaluate(() => {
    const canvas = document.getElementById('focus-harness-canvas')!
    canvas.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    ;(document.activeElement as HTMLElement | null)?.blur()
    const harness = (
      window as unknown as {
        focusHarness: { store: { setState: (state: unknown) => void }; continued: unknown }
      }
    ).focusHarness
    harness.store.setState({
      rehearsalResults: {
        '/focus/repo': {
          kind: 'report',
          report: { ...(harness.continued as Record<string, unknown>), id: 'continued-preview-3' }
        }
      }
    })
  })
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true)
})
