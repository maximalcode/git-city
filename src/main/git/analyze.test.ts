import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeRepo, pickSampleIndices } from './analyze'

let repo: string

const git = (...args: string[]): void => {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: repo,
    stdio: 'pipe'
  })
}

const lines = (n: number, tag: string): string =>
  Array.from({ length: n }, (_, i) => `${tag} line ${i}`).join('\n') + '\n'

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'git-city-test-'))
  git('init', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), lines(3, 'a'))
  git('add', '.')
  git('commit', '-m', 'first: add a.txt')

  writeFileSync(join(repo, 'a.txt'), lines(5, 'a'))
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src', 'b.ts'), lines(10, 'b'))
  git('add', '.')
  git('commit', '-m', 'second: grow a.txt, add src/b.ts')

  git('rm', 'a.txt')
  git('commit', '-m', 'third: delete a.txt')
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('analyzeRepo', () => {
  it('replays line counts, commit counts and deletions exactly', async () => {
    const result = await analyzeRepo(repo, 50, () => {})

    expect(result.info.commitCount).toBe(3)
    expect(result.info.branch).toBe('main')
    expect(result.snapshots).toHaveLength(3)

    const [s1, s2, s3] = result.snapshots

    expect(s1.files).toHaveLength(1)
    expect(s1.files[0]).toMatchObject({ path: 'a.txt', loc: 3, commits: 1 })
    expect(s1.message).toBe('first: add a.txt')

    const s2ByPath = Object.fromEntries(s2.files.map((f) => [f.path, f]))
    expect(s2.files).toHaveLength(2)
    expect(s2ByPath['a.txt']).toMatchObject({ loc: 5, commits: 2 })
    expect(s2ByPath['src/b.ts']).toMatchObject({ loc: 10, commits: 1 })

    expect(s3.files).toHaveLength(1)
    expect(s3.files[0]).toMatchObject({ path: 'src/b.ts', loc: 10 })
    expect(s3.files[0].lastAuthor).toBe('Test')
  })

  it('rejects non-repo folders', async () => {
    await expect(analyzeRepo(tmpdir(), 50, () => {})).rejects.toThrow(/not a git repository/i)
  })

  it('reports monotonic progress up to the commit count', async () => {
    const seen: number[] = []
    await analyzeRepo(repo, 50, (p) => {
      if (p.phase === 'reading-history') seen.push(p.done)
    })
    expect(seen[seen.length - 1]).toBe(3)
  })
})

describe('analyzeRepo — repos with no history', () => {
  it('opens a fresh repo with no commits as an empty analysis (does not throw)', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'git-city-empty-'))
    try {
      execFileSync('git', ['init', '-b', 'trunk'], { cwd: fresh, stdio: 'pipe' })
      const result = await analyzeRepo(fresh, 50, () => {})
      expect(result.info.commitCount).toBe(0)
      expect(result.info.branch).toBe('trunk') // unborn branch name still resolves
      expect(result.snapshots).toHaveLength(0)
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
  })

  it('labels a detached HEAD instead of reporting the literal "HEAD"', async () => {
    const det = mkdtempSync(join(tmpdir(), 'git-city-detach-'))
    const g = (...a: string[]): void => {
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.co', ...a], {
        cwd: det,
        stdio: 'pipe'
      })
    }
    try {
      g('init', '-b', 'main')
      writeFileSync(join(det, 'f.txt'), 'x\n')
      g('add', '.')
      g('commit', '-m', 'c1')
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: det }).toString().trim()
      g('checkout', head) // detach
      const result = await analyzeRepo(det, 50, () => {})
      expect(result.info.branch).toMatch(/^detached @ /)
      expect(result.info.commitCount).toBe(1)
    } finally {
      rmSync(det, { recursive: true, force: true })
    }
  })
})

describe('pickSampleIndices', () => {
  it('includes first and last commits and stays within range', () => {
    const picks = pickSampleIndices(1000, 50)
    expect(picks.has(0)).toBe(true)
    expect(picks.has(999)).toBe(true)
    for (const i of picks) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(1000)
    }
    expect(picks.size).toBeLessThanOrEqual(51)
  })

  it('samples every commit for small repos', () => {
    expect(pickSampleIndices(5, 50).size).toBe(5)
  })
})
