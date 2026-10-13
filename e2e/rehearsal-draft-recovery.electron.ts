import { discardFixtureRehearsals } from './rehearsal-fixture-cleanup'
import { expect, test } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { launchNativeFocusApp } from './native-focus'
import { reviewedApplyRequest } from './rehearsal-review-assertions'

test('retained conflict draft survives CLI continuation and blocks Apply until discarded', async () => {
  test.setTimeout(150_000)
  const tool = process.env.GIT_CITY_REHEARSE_BIN
  expect(tool, 'Set GIT_CITY_REHEARSE_BIN to a compatible real executable').toBeTruthy()
  const userData = await mkdtemp(join(tmpdir(), 'git-city-draft-recovery-user-data-'))
  const root = await mkdtemp(join(tmpdir(), 'git-city-draft-recovery-'))
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgSign', 'false')
  await writeFile(join(root, 'file.txt'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'base')
  git('checkout', '-b', 'topic')
  await writeFile(join(root, 'file.txt'), 'topic version\n')
  git('commit', '-am', 'topic')
  git('checkout', 'main')
  await writeFile(join(root, 'file.txt'), 'main version\n')
  git('commit', '-am', 'main')

  const original = {
    head: git('rev-parse', 'HEAD'),
    index: await readFile(join(root, '.git/index')),
    file: await readFile(join(root, 'file.txt'))
  }
  const app = await launchNativeFocusApp(root, userData, tool!)
  try {
    const page = app.page
    await page.getByRole('button', { name: 'Open a local repository…' }).click()
    const onboarding = page.getByRole('button', { name: 'Got it', exact: true })
    if (await onboarding.isVisible()) await onboarding.click()
    await page.getByRole('button', { name: 'Rehearse panel' }).click()
    await page.getByLabel('Branch or commit to merge into the current checkout').fill('topic')
    await page.keyboard.press('Enter')

    const editor = page.getByRole('region', { name: 'Sandbox conflict editor' })
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: 'Resolve file.txt', exact: true }).click()
    await editor.getByRole('button', { name: 'Edit whole file', exact: true }).click()
    await editor.getByLabel('Resolved file text').fill('app draft must remain inspectable\n')
    await expect(editor).toContainText('Editor draft saved locally')

    const retained = await page.evaluate(async (repo) => {
      const listing = await window.gitCity.rehearsalList(repo)
      const identity = listing.entries.find((entry) => entry.execution === 'stopped')
      if (!identity) throw new Error('The stopped conflict rehearsal was not retained')
      const shown = await window.gitCity.rehearsalShow(identity)
      if (shown.kind !== 'report' || !shown.report.sandbox)
        throw new Error('The retained conflict report has no sandbox')
      return { identity, sandbox: shown.report.sandbox }
    }, root)

    await writeFile(join(retained.sandbox, 'file.txt'), 'cli resolution\n')
    execFileSync('git', ['add', 'file.txt'], { cwd: retained.sandbox })
    const continued = JSON.parse(
      execFileSync(tool!, ['--json', '--keep', 'continue', retained.identity.id], {
        cwd: root,
        encoding: 'utf8'
      })
    )
    expect(continued.schema).toBe(1)
    expect(continued.id).toBe(retained.identity.id)
    expect(continued.outcome).toBe('clean')
    const toolResultHead = continued.result_endpoints?.results?.HEAD
    expect(toolResultHead).toBeTruthy()

    expect(git('rev-parse', 'HEAD')).toBe(original.head)
    expect(await readFile(join(root, '.git/index'))).toEqual(original.index)
    expect(await readFile(join(root, 'file.txt'))).toEqual(original.file)

    await editor.getByRole('button', { name: 'Refresh sandbox', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Merge preview completed' })).toBeVisible()
    const drafts = page.getByRole('region', { name: 'Retained rehearsal drafts' })
    const retainedDraft = drafts.getByRole('region', { name: 'Retained draft for file.txt' })
    await expect(retainedDraft).toContainText('Inspect it or explicitly discard it')
    await retainedDraft.getByText('Inspect retained draft for file.txt', { exact: true }).click()
    await expect(retainedDraft.locator('pre')).toHaveText('app draft must remain inspectable\n')
    await page.screenshot({ path: 'test-results/rehearsal-retained-draft-recovery.png' })

    const shown = await page.evaluate(
      async ({ repo, id }) => {
        const listing = await window.gitCity.rehearsalList(repo)
        const identity = listing.entries.find((entry) => entry.id === id)
        if (!identity) throw new Error('The refreshed rehearsal identity is missing')
        const result = await window.gitCity.rehearsalShow(identity)
        if (result.kind !== 'report') throw new Error('The refreshed report is unavailable')
        return result.report
      },
      { repo: root, id: retained.identity.id }
    )
    const request = await reviewedApplyRequest(page, shown)
    const refused = await page.evaluate(
      (confirmation) => window.gitCity.rehearsalApply(confirmation),
      request
    )
    expect(refused.kind, JSON.stringify(refused)).toBe('refused')
    expect(JSON.stringify(refused)).toMatch(/draft/i)
    expect(git('rev-parse', 'HEAD')).toBe(original.head)
    expect(await readFile(join(root, '.git/index'))).toEqual(original.index)
    expect(await readFile(join(root, 'file.txt'))).toEqual(original.file)

    await retainedDraft
      .getByRole('button', { name: 'Discard retained draft for file.txt', exact: true })
      .click()
    await expect(retainedDraft).toHaveCount(0)
    const apply = page.getByRole('button', { name: 'Apply', exact: true })
    await expect(apply).toBeEnabled()
    await apply.click()
    await page.getByRole('button', { name: 'Apply rehearsal', exact: true }).click()
    await expect(page.getByText('The checked rehearsal was applied.')).toBeVisible()
    expect(git('rev-parse', 'HEAD')).toBe(toolResultHead)
    expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('cli resolution\n')
  } finally {
    await app.close()
    try {
      execFileSync(tool!, ['--json', 'recover', '--rollback'], { cwd: root })
    } catch {
      /* no pending recovery */
    }
    await discardFixtureRehearsals(tool!, root)
    await rm(root, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
