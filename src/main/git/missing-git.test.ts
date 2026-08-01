import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'os'

/**
 * The machine with no git.
 *
 * Installing the .exe or .dmg does not install git, so this is a real first-run
 * state for a stranger — and the failure has to name the cause rather than
 * blaming the folder they picked.
 *
 * The modules are re-imported with PATH already emptied, because exec.ts
 * snapshots process.env into GIT_ENV at load time; clearing PATH afterwards
 * would leave the child processes with the original one.
 */

const realPath = process.env.PATH

afterEach(() => {
  process.env.PATH = realPath
  vi.resetModules()
})

async function loadWithoutGit(): Promise<{
  runGit: typeof import('./exec').runGit
  runGitLines: typeof import('./exec').runGitLines
  analyzeRepo: typeof import('./analyze').analyzeRepo
  FriendlyError: typeof import('./result').FriendlyError
}> {
  vi.resetModules()
  process.env.PATH = ''
  const [exec, analyze, result] = await Promise.all([
    import('./exec'),
    import('./analyze'),
    import('./result')
  ])
  return {
    runGit: exec.runGit,
    runGitLines: exec.runGitLines,
    analyzeRepo: analyze.analyzeRepo,
    FriendlyError: result.FriendlyError
  }
}

describe('when git is not installed', () => {
  it('runGit rejects with an actionable FriendlyError', async () => {
    const { runGit, FriendlyError } = await loadWithoutGit()
    await expect(runGit(tmpdir(), ['status'])).rejects.toBeInstanceOf(FriendlyError)
    await expect(runGit(tmpdir(), ['status'])).rejects.toThrow(/not installed.*PATH/i)
    await expect(runGit(tmpdir(), ['status'])).rejects.toThrow(/git-scm\.com/)
  })

  it('runGitLines rejects with the same error rather than a bare ENOENT', async () => {
    const { runGitLines, FriendlyError } = await loadWithoutGit()
    await expect(runGitLines(tmpdir(), ['log'], () => {})).rejects.toBeInstanceOf(FriendlyError)
  })

  it('opening a repo blames the missing git, not the folder', async () => {
    const { analyzeRepo } = await loadWithoutGit()
    // the guard in analyzeRepo would otherwise swallow this into
    // "not a git repository", which sends the user looking in the wrong place
    await expect(analyzeRepo(tmpdir(), 10, () => {})).rejects.toThrow(/not installed/i)
  })
})
