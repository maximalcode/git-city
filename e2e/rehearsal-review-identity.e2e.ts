import { test, expect } from '@playwright/test'

function report(id: string, repository: string) {
  return {
    id,
    repository,
    origin_worktree: repository,
    repository_id: 'shared-repository',
    schema: 1,
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
}

test('resets review-local selection when a new rehearsal identity reuses a path', async ({
  page
}) => {
  await page.goto('/?mock')
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
    const React = ReactModule.default
    const ReactDOM = ReactDomModule.default
    const identity = (id: string, repository: string) => ({
      id,
      repository,
      origin_worktree: repository,
      repository_id: 'shared-repository'
    })
    const side = { present: true, mode: '100644', objectId: 'a'.repeat(40) }
    const entry = (entryId: string, path: string) => ({
      entryId,
      change: 'modified',
      oldPath: path,
      newPath: path,
      old: side,
      new: side,
      binary: false,
      type: 'text',
      text: { changes: 'available', before: 'available', after: 'available' },
      lines: { before: 1, after: 1, additions: 1, deletions: 1 }
    })
    const first = identity('first-review', '/first')
    const second = identity('second-review', '/second')
    const firstEntries = [entry('old', 'old.txt'), entry('shared', 'shared.txt')]
    const secondEntries = [entry('shared', 'shared.txt')]
    let releaseFirstFile: (() => void) | null = null
    const firstFile = new Promise<void>((resolve) => {
      releaseFirstFile = resolve
    })
    const response = (
      reviewIdentity: typeof first,
      revision: string,
      entries: typeof firstEntries
    ) => ({
      identity: reviewIdentity,
      reviewRevision: revision,
      toolResultRevision: null,
      complete: true,
      afterAvailable: true,
      afterReason: null,
      scopes: [
        {
          scopeId: 'tracked-worktree',
          kind: 'tracked-worktree',
          label: 'Tracked worktree',
          refAliases: [],
          before: { kind: 'commit', commit: 'b'.repeat(40), provenance: 'original' },
          after: { kind: 'commit', commit: 'c'.repeat(40), provenance: 'carried' },
          available: true
        }
      ],
      defaultScopeId: 'tracked-worktree',
      notices: [],
      carried: null,
      changeMap: { 'tracked-worktree': [] },
      entries
    })
    const fileResponse = (
      reviewIdentity: typeof first,
      revision: string,
      entryId: string,
      view: string,
      text: string
    ) => ({
      identity: reviewIdentity,
      reviewRevision: revision,
      scopeId: 'tracked-worktree',
      entryId,
      view,
      availability: 'available',
      text,
      hunks: [],
      entry: entry(entryId, 'shared.txt')
    })
    const api = {
      rehearsalReviewSummary: async (reviewIdentity: typeof first) =>
        reviewIdentity.id === first.id
          ? response(first, 'revision-first', firstEntries)
          : response(second, 'revision-second', secondEntries),
      rehearsalReviewFiles: async (reviewIdentity: typeof first) => ({
        identity: reviewIdentity,
        reviewRevision: reviewIdentity.id === first.id ? 'revision-first' : 'revision-second',
        scopeId: 'tracked-worktree',
        entries: reviewIdentity.id === first.id ? firstEntries : secondEntries,
        nextCursor: null,
        total: reviewIdentity.id === first.id ? firstEntries.length : secondEntries.length,
        complete: true,
        filter: null
      }),
      rehearsalReviewFile: async (
        reviewIdentity: typeof first,
        revision: string,
        _scopeId: string,
        entryId: string,
        view: string
      ) => {
        if (reviewIdentity.id === first.id && entryId === 'shared') {
          await firstFile
          return fileResponse(first, revision, entryId, view, 'first identity')
        }
        return fileResponse(
          reviewIdentity.id === first.id ? first : second,
          revision,
          entryId,
          view,
          reviewIdentity.id === first.id ? 'first identity' : 'second identity'
        )
      }
    }
    bridgeModule.setBridge(api as never)
    const host = document.createElement('div')
    host.id = 'r4-review-identity-harness'
    document.body.append(host)
    const root = ReactDOM.createRoot(host)
    const render = (reviewReport: unknown): void => {
      root.render(React.createElement(panelModule.default, { report: reviewReport }))
    }
    ;(window as unknown as { r4ReviewIdentity: unknown }).r4ReviewIdentity = {
      first,
      second,
      render,
      releaseFirstFile: () => releaseFirstFile?.()
    }
    render({
      ...first,
      schema: 1,
      command: ['merge', 'topic'],
      checkout: { kind: 'branch', target: 'main' },
      pre_state: {},
      lifecycle: 'kept',
      outcome: 'clean',
      conflicted: false,
      refs: [],
      conflicts: [],
      drift: [],
      drift_unexpected: false
    })
  })

  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  const files = review.getByRole('listbox', { name: 'Changed files' })
  await expect(files.getByRole('option')).toHaveCount(2)
  await files.getByRole('option').filter({ hasText: 'shared.txt' }).click()
  await page.evaluate(() => {
    const state = (
      window as unknown as { r4ReviewIdentity: { second: unknown; render: (r: unknown) => void } }
    ).r4ReviewIdentity
    state.render({
      ...state.second,
      schema: 1,
      command: ['merge', 'topic'],
      checkout: { kind: 'branch', target: 'main' },
      pre_state: {},
      lifecycle: 'kept',
      outcome: 'clean',
      conflicted: false,
      refs: [],
      conflicts: [],
      drift: [],
      drift_unexpected: false
    })
  })
  await expect(files.getByRole('option')).toHaveCount(1)
  await expect(files.getByRole('option')).toHaveAttribute('aria-selected', 'true')
  await expect(review.locator('pre')).toHaveText('second identity')
  await page.evaluate(() => {
    ;(
      window as unknown as { r4ReviewIdentity: { releaseFirstFile: () => void } }
    ).r4ReviewIdentity.releaseFirstFile()
  })
  await expect(review.locator('pre')).toHaveText('second identity')
})

test('picks a rendered change beyond the first page while a conflicting filter is active', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.waitForFunction(() => {
    const mock = window as unknown as { __gitCityMock?: { store?: unknown } }
    return !!mock.__gitCityMock?.store
  })
  await page.evaluate(async () => {
    const [bridgeModule, storeModule, mockModule] = await Promise.all([
      import('/src/lib/bridge.ts'),
      import('/src/store.ts'),
      import('/src/lib/devMock.ts')
    ])
    const source = mockModule.buildMockAnalysis(250)
    const last = source.snapshots.at(-1)!
    // The comparison has two complete frozen endpoints. Keep surrounding roofs
    // low so the real pointer ray can reach the chosen building in this fixture.
    last.loc.fill(1)
    last.binary.fill(0)
    last.loc[Array.from(last.pathId).indexOf(220)] = 1000
    const analysis = {
      ...source,
      snapshots: [
        { ...last, index: 0, hash: 'b'.repeat(40) },
        { ...last, index: 1, hash: 'c'.repeat(40) }
      ]
    }
    const targetPath = analysis.paths[220]
    const identity = {
      id: 'r6-city-pick',
      repository: '/r6/repo',
      origin_worktree: '/r6/repo',
      repository_id: 'r6-repository'
    }
    const report = {
      ...identity,
      schema: 1 as const,
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
    const side = { present: true, mode: '100644', objectId: 'a'.repeat(40) }
    const entries = analysis.paths.map((path, index) => ({
      entryId: `entry-${index}`,
      change: 'modified' as const,
      oldPath: path,
      newPath: path,
      old: side,
      new: side,
      binary: false,
      type: 'text' as const,
      rename: 'not-detected' as const,
      text: {
        changes: 'available' as const,
        before: 'available' as const,
        after: 'available' as const
      },
      lines: { before: 1, after: 1, additions: 1, deletions: 1 }
    }))
    const summary = {
      identity,
      reviewRevision: 'r6-revision',
      toolResultRevision: null,
      complete: true,
      afterAvailable: true,
      afterReason: null,
      scopes: [
        {
          scopeId: 'tracked-worktree',
          kind: 'tracked-worktree' as const,
          label: 'Tracked worktree',
          refAliases: ['HEAD'],
          before: {
            kind: 'commit' as const,
            commit: 'b'.repeat(40),
            provenance: 'original' as const
          },
          after: {
            kind: 'commit' as const,
            commit: 'c'.repeat(40),
            provenance: 'original' as const
          },
          available: true
        }
      ],
      defaultScopeId: 'tracked-worktree',
      notices: [],
      replayWarnings: [],
      carried: null,
      changeMap: {
        'tracked-worktree': entries.map(({ binary, type, text, lines, ...metadata }) => metadata)
      }
    }
    const api = {
      rehearsalAvailability: async () => ({ available: true, configured: true, message: '' }),
      rehearsalRecovery: async () => ({
        state: 'none' as const,
        repository: identity.repository,
        can_complete: false,
        can_rollback: false,
        message: ''
      }),
      rehearsalReviewSummary: async () => summary,
      rehearsalReviewFiles: async (
        _request: unknown,
        _revision: string,
        _scope: string,
        _cursor?: string,
        filter?: string
      ) => {
        const filtered = filter
          ? entries.filter((entry) => entry.newPath.includes(filter))
          : entries
        return {
          identity,
          reviewRevision: 'r6-revision',
          scopeId: 'tracked-worktree',
          entries: filtered.slice(0, 200),
          nextCursor: !filter && filtered.length > 200 ? 'page-200' : null,
          total: filtered.length,
          complete: true,
          filter: filter || null
        }
      },
      rehearsalReviewFile: async (
        _request: unknown,
        _revision: string,
        _scope: string,
        entryId: string,
        view: string
      ) => {
        const entry = entries.find((candidate) => candidate.entryId === entryId)!
        return {
          identity,
          reviewRevision: 'r6-revision',
          scopeId: 'tracked-worktree',
          entryId,
          view,
          availability: 'available' as const,
          text: `${entry.newPath}\n`,
          hunks: [],
          entry
        }
      },
      rehearsalComparison: async () => ({
        reportKey: JSON.stringify([
          report.id,
          report.repository_id,
          report.origin_worktree,
          report.repository,
          report.sandbox,
          report.checkout,
          report.pre_state,
          report.refs,
          report.outcome,
          report.conflicted,
          report.conflicts,
          report.carried
        ]),
        identity,
        analysis,
        afterAvailable: true,
        notice: 'Mock frozen comparison'
      })
    }
    bridgeModule.setBridge(api as never)
    storeModule.useStore.setState({
      screen: 'city',
      analysis,
      snapshotIndex: 1,
      reduceMotion: true,
      rehearsalConfigured: true,
      rehearsalModeSetting: { repository: identity.repository, mode: 'ask' },
      repoPath: identity.repository,
      rehearsalOpen: true,
      rehearsalBusy: false,
      rehearsalResults: { [identity.repository]: { kind: 'report', report } },
      rehearsalComparison: null
    })
    ;(window as unknown as { r6CityPick: { targetPath: string } }).r6CityPick = { targetPath }
  })

  await page.getByRole('button', { name: 'Got it', exact: true }).click()
  const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
  const targetPath = await page.evaluate(
    () => (window as unknown as { r6CityPick: { targetPath: string } }).r6CityPick.targetPath
  )
  const files = review.getByRole('listbox', { name: 'Changed files' })
  await expect(files.getByRole('option')).toHaveCount(200)
  await expect(files.getByRole('option').filter({ hasText: targetPath })).toHaveCount(0)
  await review.getByRole('textbox', { name: 'Filter files' }).fill('path-that-does-not-match')
  await review.getByRole('textbox', { name: 'Filter files' }).press('Enter')
  await expect(files.getByRole('option').filter({ hasText: targetPath })).toHaveCount(0)
  await review.getByRole('button', { name: 'Show city context', exact: true }).click()
  const city = review.getByRole('region', { name: 'Rehearsal city comparison' })
  await city.getByRole('button', { name: 'Compare city', exact: true }).click()
  await page.waitForFunction(() => {
    const probe = window as unknown as { __gitCitySceneCanvas?: HTMLCanvasElement }
    return probe.__gitCitySceneCanvas === document.querySelector('.rehearsal-city canvas')
  })
  await expect(page.locator('canvas:not(.minimap canvas)')).toHaveCount(1)
  const point = await page.evaluate((path) => {
    const probe = window as unknown as {
      __gitCityScene?: { getObjectByName(name: string): any }
      __gitCityCam?: any
      __gitCitySceneCanvas?: HTMLCanvasElement
    }
    const mesh = probe.__gitCityScene?.getObjectByName('file-buildings')
    const camera = probe.__gitCityCam
    const canvas = probe.__gitCitySceneCanvas
    const index = (mesh?.userData.filePaths as string[] | undefined)?.indexOf(path) ?? -1
    if (!mesh || !camera || !canvas || index < 0) throw new Error('Target building is not rendered')
    const offset = index * 16
    const elements = mesh.instanceMatrix.array
    const scaleY = Math.hypot(elements[offset + 1], elements[offset + 5], elements[offset + 9])
    const projected = camera.position
      .clone()
      .set(elements[offset + 12], elements[offset + 13] + scaleY * 0.45, elements[offset + 14])
      .applyMatrix4(mesh.matrixWorld)
      .project(camera)
    const rect = canvas.getBoundingClientRect()
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height
    }
  }, targetPath)
  await page.mouse.click(point.x, point.y)
  const selected = files.getByRole('option').filter({ hasText: targetPath })
  await expect(selected).toBeVisible()
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(review.locator('pre')).toHaveText(`${targetPath}\n`)
})

test('blocks repository exit until the draft guard settles and preserves a canceled failure', async ({
  page
}) => {
  await page.goto('/?mock')
  await page.waitForFunction(() => {
    const mock = (window as unknown as { __gitCityMock?: { store?: unknown } }).__gitCityMock
    return !!mock?.store
  })
  await page.evaluate(async () => {
    const [storeModule, navigationModule] = await Promise.all([
      import('/src/store.ts'),
      import('/src/panels/rehearsalNavigation.ts')
    ])
    let release: ((allowed: boolean) => void) | null = null
    const pending = new Promise<boolean>((resolve) => {
      release = resolve
    })
    const actions: string[] = []
    const unregister = navigationModule.registerRehearsalNavigationGuard(async (action) => {
      actions.push(action)
      return pending
    })
    const leave = storeModule.useStore.getState().backToWelcome()
    ;(
      window as unknown as {
        r4Navigation: {
          actions: string[]
          leave: Promise<void>
          release: (allowed: boolean) => void
          unregister: () => void
        }
      }
    ).r4Navigation = {
      actions,
      leave,
      release: (allowed) => release?.(allowed),
      unregister
    }
  })
  await expect(page.getByText('Watch your repository come alive as a city.')).not.toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { r4Navigation: { actions: string[] } }).r4Navigation.actions
    )
  ).toEqual(['return to the welcome screen'])
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __gitCityMock: { store: { getState(): { repoPath: string | null } } }
          }
        ).__gitCityMock.store.getState().repoPath
    )
  ).toBe('C:/mock/mock-repo')
  await page.evaluate(() => {
    ;(
      window as unknown as { r4Navigation: { release: (allowed: boolean) => void } }
    ).r4Navigation.release(false)
  })
  await page.evaluate(
    () => (window as unknown as { r4Navigation: { leave: Promise<void> } }).r4Navigation.leave
  )
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __gitCityMock: { store: { getState(): { repoPath: string | null } } }
          }
        ).__gitCityMock.store.getState().repoPath
    )
  ).toBe('C:/mock/mock-repo')

  await page.evaluate(async () => {
    const [storeModule, navigationModule, bridgeModule] = await Promise.all([
      import('/src/store.ts'),
      import('/src/panels/rehearsalNavigation.ts'),
      import('/src/lib/bridge.ts')
    ])
    let repoSizeCalls = 0
    bridgeModule.setBridge({
      repoSize: async () => {
        repoSizeCalls += 1
        return { commits: 0, files: 0 }
      }
    } as never)
    const actions: string[] = []
    storeModule.useStore.setState({
      worktrees: [
        {
          path: '/second-worktree',
          head: 'a'.repeat(40),
          branch: 'topic',
          bare: false,
          detached: false,
          locked: false
        }
      ]
    })
    const unregister = navigationModule.registerRehearsalNavigationGuard(async (action) => {
      actions.push(action)
      return false
    })
    await storeModule.useStore.getState().openPath('/second-worktree')
    if (actions.join('|') !== 'switch worktrees') throw new Error(`unexpected actions: ${actions}`)
    if (repoSizeCalls !== 0) throw new Error('repoSize ran before navigation was admitted')
    if (storeModule.useStore.getState().repoPath !== 'C:/mock/mock-repo')
      throw new Error('rejected switch changed the active repository')
    unregister()
    bridgeModule.setBridge(null)
  })
})
