import { expandRehearsal } from './rehearsal-ui'
import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { discardFixtureRehearsals } from './rehearsal-fixture-cleanup'
import { expectFrozenReview } from './rehearsal-review-assertions'

for (const conflict of [false, true]) {
  test(`keyboard interactive plan ${conflict ? 'continues repeated conflicts' : 'reorders, squashes and drops'} before Apply`, async () => {
    const tool = process.env.GIT_CITY_REHEARSE_BIN!
    expect(tool).toBeTruthy()
    const userData = await mkdtemp(join(tmpdir(), 'city-user-'))
    const root = await mkdtemp(join(tmpdir(), 'city-plan-'))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    for (let i = 0; i < 4; i++) {
      await writeFile(join(root, conflict ? 'file' : `file${i}`), `${i}\n`)
      git('add', '.')
      git('commit', '-m', `commit${i}`)
    }
    const before = {
      head: git('rev-parse', 'HEAD'),
      index: await readFile(join(root, '.git/index'))
    }
    const app = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${userData}`],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        GIT_CITY_REHEARSE_BIN: tool
      }
    })
    try {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, root)
      const page = await app.firstWindow()
      await page.getByRole('button', { name: 'Open a local repository…' }).click()
      await expect(page.getByRole('button', { name: 'Rehearse panel' })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.keyboard.press('b')
      await page.getByTitle('Interactive rebase', { exact: true }).focus()
      await page.keyboard.press('Enter')
      const row = (subject: string) =>
        page.locator('.rebase-row').filter({ has: page.getByText(subject, { exact: true }) })
      await row('commit1').getByRole('button', { name: 'drop', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(
        row('commit1').getByRole('button', { name: 'drop', exact: true })
      ).toHaveAttribute('aria-pressed', 'true')
      if (!conflict) {
        await row('commit3').getByTitle('Move down').focus()
        await page.keyboard.press('Enter')
        await expect(page.locator('.rebase-row').first()).toContainText('commit2')
        await row('commit2').getByRole('button', { name: 'squash', exact: true }).focus()
        await page.keyboard.press('Enter')
      }
      const entry = page.getByRole('button', { name: 'Rehearse interactive rebase', exact: true })
      await entry.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: 'Rehearse', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expandRehearsal(page, /^Review changes$/)
      await expect(page.getByRole('region', { name: 'Rehearsed plan' })).toContainText('drop')
      const retainedId = page.getByText('Kept rehearsal:', { exact: false }).locator('code')
      const stoppedId = conflict ? await retainedId.textContent() : null
      if (conflict) {
        expect(stoppedId).toBeTruthy()
        for (let stop = 0; stop < 2; stop++) {
          const editor = page.getByRole('region', { name: 'Sandbox conflict editor' })
          await expect(editor).toBeVisible()
          await expect(retainedId).toHaveText(stoppedId!)
          await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
          const review = page.getByRole('region', { name: 'Frozen rehearsal review' })
          const stoppedReview = await page.evaluate(
            async ({ root, stoppedId }) => {
              const listing = await window.gitCity.rehearsalList(root)
              const identity = listing.entries.find((item) => item.id === stoppedId)
              if (!identity) throw new Error('The stopped rehearsal is missing')
              return window.gitCity.rehearsalReviewSummary(identity)
            },
            { root, stoppedId }
          )
          expect(stoppedReview.identity.id).toBe(stoppedId)
          expect(stoppedReview.afterAvailable).toBe(false)
          expect(stoppedReview.afterReason).toBeTruthy()
          await expect(review.getByText(stoppedReview.afterReason!, { exact: false })).toBeVisible()
          await expect(review.getByRole('tab', { name: 'After', exact: true })).toHaveCount(0)
          for (const name of ['Resolve file', 'Edit whole file']) {
            await expect(editor.getByRole('button', { name, exact: true })).toBeEnabled()
            await editor.getByRole('button', { name, exact: true }).focus()
            await page.keyboard.press('Enter')
            if (name === 'Resolve file') {
              await expect(
                editor.getByRole('heading', { name: 'Section 1: Unreviewed' })
              ).toBeVisible()
              await editor.getByRole('button', { name: 'Both', exact: true }).focus()
              await page.keyboard.press('Enter')
              await expect(editor.locator('.seg-theirs')).toHaveText(`${stop + 2}\n`)
            }
          }
          await editor.getByLabel('Resolved file text').fill(`resolved ${stop}\n`)
          await expect(
            editor.getByRole('button', { name: 'Save and stage in sandbox' })
          ).toBeDisabled()
          await editor.getByRole('button', { name: 'Confirm complete file resolution' }).click()
          await editor.getByRole('button', { name: 'Save and stage in sandbox' }).focus()
          await page.keyboard.press('Enter')
          await expect(editor.getByRole('button', { name: 'Continue rehearsal' })).toBeEnabled()
          await editor.getByRole('button', { name: 'Continue rehearsal' }).focus()
          await page.keyboard.press('Enter')
          await expect(page.locator('.rehearsal-panel [aria-busy]')).toHaveAttribute(
            'aria-busy',
            'false'
          )
          await expandRehearsal(page, /^Review changes$/)
          await expect(page.getByRole('region', { name: 'Rehearsed plan' })).toContainText('drop')
        }
      }
      await expect(page.getByRole('heading', { name: 'Rebase preview completed' })).toBeVisible()
      expect(git('rev-parse', 'HEAD')).toBe(before.head)
      expect(await readFile(join(root, '.git/index'))).toEqual(before.index)
      if (!conflict) {
        await page.keyboard.press('Escape')
        await expect(entry).toBeFocused()
        await page.getByRole('button', { name: 'Rehearse panel' }).click()
        await expandRehearsal(page, /^Rehearse again$/)
        await expect(
          page.getByLabel('Interactive plan base (Root includes the root commit)')
        ).toHaveValue('root')
        const retainedId = page.getByText('Kept rehearsal:', { exact: false }).locator('code')
        const previousId = await retainedId.textContent()
        expect(previousId).toBeTruthy()
        await page.getByRole('button', { name: 'Rehearse', exact: true }).click()
        await expect(retainedId).not.toHaveText(previousId!)
        await expect(page.locator('.rehearsal-panel [aria-busy]')).toHaveAttribute(
          'aria-busy',
          'false'
        )
        await expect(page.getByRole('heading', { name: 'Rebase preview completed' })).toBeVisible()
        await expandRehearsal(page, /^Review changes$/)
        await expect(page.getByRole('region', { name: 'Rehearsed plan' })).toContainText('drop')
      }
      // Rehearse again retains the older preview too. Inspect the preview shown
      // in the panel, whose identity is independent of CLI list ordering.
      const reviewedId = await page
        .getByText('Kept rehearsal:', { exact: false })
        .locator('code')
        .textContent()
      expect(reviewedId).toBeTruthy()
      const frozenId = await expectFrozenReview(
        page,
        root,
        conflict ? 'file' : 'file1',
        conflict ? '3\n' : '1\n',
        conflict ? 'resolved 1\n' : null
      )
      expect(frozenId).toBe(reviewedId)
      if (conflict) expect(frozenId).toBe(stoppedId)
      const report = JSON.parse(
        execFileSync(tool, ['--json', 'show', reviewedId!], {
          cwd: root,
          encoding: 'utf8'
        })
      )
      const expected = execFileSync('git', ['rev-list', 'HEAD'], {
        cwd: report.sandbox,
        encoding: 'utf8'
      }).trim()
      await page.keyboard.press('Escape')
      await expect(page.locator('.rehearsal-panel')).toBeHidden()
      await expect(
        conflict ? entry : page.getByRole('button', { name: 'Rehearse panel' })
      ).toBeFocused()
      await page.getByRole('button', { name: 'Rehearse panel' }).click()
      await page.getByRole('button', { name: 'Apply', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: 'Cancel Apply' })).toBeFocused()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Enter')
      await expect(page.getByText('The checked rehearsal was applied.')).toBeVisible({
        timeout: 180_000
      })
      expect(git('rev-list', 'HEAD')).toBe(expected)
      if (conflict) expect(await readFile(join(root, 'file'), 'utf8')).toBe('resolved 1\n')
      else expect(git('log', '--format=%s')).toBe('commit3\ncommit0')
      await page.screenshot({ path: `test-results/rehearsal-interactive-${conflict}.png` })
    } finally {
      await app.close()
      await discardFixtureRehearsals(tool, root)
      await rm(root, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })
}
