import { expect, test } from '@playwright/test'

for (const scenario of ['obsolete', 'stage-failure'] as const) {
  test(`${scenario}: editor preserves the draft until deliberate recovery`, async ({ page }) => {
    await page.goto('/?mock')
    await page.evaluate(async (scenario) => {
      const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
      const reactUrl = resources.find((url) => url.includes('/.vite/deps/react.js'))!
      const domUrl = resources.find((url) => url.includes('/.vite/deps/react-dom_client.js'))!
      const [react, dom, editor, bridge] = await Promise.all([
        import(reactUrl),
        import(domUrl),
        import('/src/panels/RehearsalConflicts.tsx'),
        import('/src/lib/bridge.ts')
      ])
      const identity = {
        repository: '/origin',
        origin_worktree: '/origin',
        repository_id: 'repo',
        id: scenario
      }
      const base = '<<<<<<< main\nours\n=======\ntheirs\n>>>>>>> topic\n'
      let record = {
        key: { ...identity, path: 'file.txt' },
        draft_revision: 4,
        base_revision: scenario === 'obsolete' ? 'old-base' : 'current-base',
        base_content: base,
        mode: 'whole-file',
        whole_file_text: 'retained decision\n',
        choices: {},
        edits: {},
        acknowledged_hunks: ['whole-file']
      }
      let writes = 0
      let saves = 0
      bridge.setBridge({
        rehearsalDraftRead: async () => ({ status: 'saved', record }),
        rehearsalDraftWrite: async (_identity: unknown, _path: string, payload: object) => {
          writes++
          record = { ...record, ...payload, draft_revision: record.draft_revision + 1 }
          return { status: 'saved', record }
        },
        rehearsalDraftDiscard: async () => ({ status: 'absent' }),
        rehearsalConflictSave: async () => {
          saves++
          throw new Error(
            'Saved in the sandbox, but staging failed. Refresh sandbox before retrying.'
          )
        }
      } as never)
      document.getElementById('root')!.style.display = 'none'
      const host = document.createElement('div')
      document.body.append(host)
      const root = dom.default.createRoot(host)
      const render = (revision: string): void =>
        root.render(
          react.default.createElement(editor.ConflictEditor, {
            report: {
              ...identity,
              command: ['merge', 'topic'],
              checkout: { kind: 'branch', target: 'main' }
            },
            buffer: {
              revision,
              base_content: base,
              file: {
                path: 'file.txt',
                binary: false,
                segments: [
                  {
                    kind: 'conflict',
                    id: 0,
                    ours: 'ours\n',
                    theirs: 'theirs\n',
                    oursLabel: 'main',
                    theirsLabel: 'topic'
                  }
                ]
              }
            },
            disabled: false,
            onSaved: () => {},
            onError: (message: string) => {
              const notice = document.createElement('p')
              notice.role = 'alert'
              notice.textContent = message
              host.append(notice)
            }
          })
        )
      ;(window as unknown as { draftSafety: unknown }).draftSafety = {
        snapshot: () => ({ record, writes, saves }),
        render
      }
      render('current-base')
    }, scenario)
    const save = page.getByRole('button', { name: 'Save and stage in sandbox' })
    if (scenario === 'obsolete') {
      await expect(page.getByText(/A retained draft is based on sandbox revision/)).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Edit whole file', exact: true })
      ).toBeDisabled()
      await expect(save).toBeDisabled()
      const snapshot = await page.evaluate(() =>
        (
          window as unknown as {
            draftSafety: { snapshot: () => { writes: number; record: { base_revision: string } } }
          }
        ).draftSafety.snapshot()
      )
      expect(snapshot.writes).toBe(0)
      expect(snapshot.record.base_revision).toBe('old-base')
      await page
        .getByRole('button', { name: 'Use retained text as a new draft on the current base' })
        .click()
      await expect(page.getByLabel('Resolved file text')).toHaveValue('retained decision\n')
      await expect(save).toBeDisabled()
      await page.getByRole('button', { name: 'Confirm complete file resolution' }).click()
      await expect(save).toBeEnabled()
    } else {
      await expect(save).toBeEnabled()
      await save.click()
      await expect(page.getByRole('alert')).toContainText('staging failed')
      await expect(save).toBeDisabled()
      await expect(page.getByLabel('Resolved file text')).toHaveValue('retained decision\n')
      await page.evaluate(() =>
        (
          window as unknown as {
            draftSafety: { render: (revision: string) => void }
          }
        ).draftSafety.render('changed-after-partial-save')
      )
      await expect(page.getByText(/A retained draft is based on sandbox revision/)).toBeVisible()
      await expect(save).toBeDisabled()
    }
  })
}
