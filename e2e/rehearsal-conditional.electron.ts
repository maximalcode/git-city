import { test, expect, _electron as electron } from '@playwright/test'
import { execFileSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { reviewedApplyRequest } from './rehearsal-review-assertions'

for (const mutation of ['result', 'carried'] as const) {
  test(`conditional Apply refuses external ${mutation} mutation without touching original state`, async () => {
    const tool = process.env.GIT_CITY_REHEARSE_BIN!
    expect(tool).toBeTruthy()
    const root = await mkdtemp(join(tmpdir(), 'city-conditional-'))
    const profile = await mkdtemp(join(tmpdir(), 'city-conditional-profile-'))
    const cache = join(profile, 'cache')
    const gitAt = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    const git = (...args: string[]): string => gitAt(root, ...args)
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    await writeFile(join(root, 'file.txt'), 'base\n')
    await writeFile(join(root, 'local.txt'), 'base local\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', 'topic')
    await writeFile(join(root, 'file.txt'), 'topic\n')
    git('commit', '-am', 'topic')
    git('checkout', 'main')
    if (mutation === 'carried') {
      await writeFile(join(root, 'local.txt'), 'staged local\n')
      git('add', 'local.txt')
      await writeFile(join(root, 'local.txt'), 'unstaged local\n')
    }
    await writeFile(join(root, 'untracked.txt'), 'excluded sentinel\n')
    const snapshot = async () => ({
      head: git('rev-parse', 'HEAD'),
      refs: git('show-ref'),
      index: await readFile(join(root, '.git/index')),
      staged: git('ls-files', '--stage'),
      tracked: await readFile(join(root, 'file.txt')),
      local: await readFile(join(root, 'local.txt')),
      untracked: await readFile(join(root, 'untracked.txt')),
      recovery: await readFile(join(root, '.git/rehearse-apply')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        }
      )
    })
    const original = await snapshot()
    const app = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        GIT_CITY_REHEARSE_BIN: tool,
        GIT_REHEARSE_CACHE_DIR: cache
      }
    })
    try {
      const page = await app.firstWindow()
      const result = await page.evaluate(
        (repo) => window.gitCity.rehearseMerge(repo, 'topic'),
        root
      )
      if (result.kind !== 'report') throw new Error(JSON.stringify(result))
      const request = await reviewedApplyRequest(page, result.report)
      // Rehearsing carried work can populate Git's index cache-tree extension.
      // Verify unchanged staged entries/files, then freeze exact bytes at the
      // review boundary whose later conditional Apply must have no effects.
      const reviewedOriginal = await snapshot()
      expect({ ...reviewedOriginal, index: original.index }).toEqual(original)
      const sandbox = result.report.sandbox!
      const carried = result.report.result_endpoints?.carried
      // The mutator is a separate real Git process. Only published descriptors
      // identify the object; discover its actual ref for this adversarial test.
      // The application itself never guesses retained ref names.
      if (mutation === 'result') {
        const changed = gitAt(
          sandbox,
          'commit-tree',
          'HEAD^{tree}',
          '-p',
          'HEAD',
          '-m',
          'external changed result'
        )
        gitAt(sandbox, 'update-ref', 'HEAD', changed)
      } else {
        expect(carried?.replay_ref).toBeTruthy()
        expect(carried?.replay).toBeTruthy()
        const changed = gitAt(
          sandbox,
          'commit-tree',
          `${carried!.replay}^{tree}`,
          '-p',
          carried!.replay!,
          '-m',
          'external changed carried snapshot'
        )
        const replayRefs = gitAt(sandbox, 'for-each-ref', '--format=%(refname) %(objectname)')
          .split('\n')
          .filter((line) => line.endsWith(` ${carried!.replay_ref}`))
          .map((line) => line.split(' ')[0])
        expect(replayRefs).toHaveLength(1)
        gitAt(sandbox, 'update-ref', replayRefs[0], changed)
      }
      const changed = await page.evaluate(
        (identity) => window.gitCity.rehearsalShow(identity),
        result.report
      )
      if (changed.kind !== 'report') throw new Error(JSON.stringify(changed))
      expect(changed.report.result_revision).not.toBe(request.expectedResultRevision)
      if (mutation === 'carried') expect(changed.report.carried).toEqual(result.report.carried)
      const refused = await page.evaluate(
        (confirmation) => window.gitCity.rehearsalApply(confirmation),
        request
      )
      expect(refused.kind, JSON.stringify(refused)).toBe('refused')
      expect(await snapshot()).toEqual(reviewedOriginal)
      const retained = await page.evaluate(
        (identity) => window.gitCity.rehearsalShow(identity),
        result.report
      )
      expect(retained.kind).toBe('report')
      expect(await readFile(join(root, 'untracked.txt'), 'utf8')).toBe('excluded sentinel\n')
    } finally {
      await app.close()
      await rm(root, { recursive: true, force: true })
      await rm(profile, { recursive: true, force: true })
    }
  })
}
