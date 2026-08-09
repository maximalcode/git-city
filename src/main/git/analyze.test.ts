import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeRepo, pickSampleIndices, resampleIndices } from './analyze'
import { materializeSnapshot } from '../../shared/snapshots'

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

    // materialize each capture back out of the columns before asserting (#62)
    const [s1, s2, s3] = result.snapshots.map((_, i) => materializeSnapshot(result, i))

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

describe('resampleIndices', () => {
  it('snaps each ideal stop onto the nearest capture that exists', () => {
    // 20 commits sampled at target 5 gave 0,5,10,14,19; three commits arrive.
    // A full re-analysis at 23 would want 0,6,11,17,22 — but 6, 11 and 17 were
    // never captured and we are not re-reading that history, so each one lands
    // on the nearest index we actually hold.
    const keep = resampleIndices([0, 5, 10, 14, 19], 20, 23, 5)
    expect([...keep].sort((a, b) => a - b)).toEqual([0, 5, 10, 19, 22])
  })

  it('keeps at most one stop more than the target', () => {
    // target + 1, the same bound pickSampleIndices has: the tip is added
    // unconditionally, and on a total that does not divide evenly it can land
    // beside a stop rather than on one
    const keep = resampleIndices([0, 5, 10, 14, 19], 20, 23, 5)
    expect(keep.size).toBeLessThanOrEqual(6)
  })

  it('always keeps the tip — the next splice re-seeds its state from it', () => {
    // target 2 wants only the ends, and the tip is one of them; target 1 is
    // clamped to 2 by pickSampleIndices. Either way the tip has to survive.
    expect(resampleIndices([0, 9], 10, 14, 2).has(13)).toBe(true)
    expect(resampleIndices([0, 9], 10, 14, 1).has(13)).toBe(true)
  })

  it('takes new commits at the ideal index, since any of them can be captured', () => {
    // the whole new region is replayable, so nothing snaps there
    const keep = resampleIndices([0, 4], 5, 45, 5)
    expect(keep.has(22)).toBe(true)
    expect(keep.has(33)).toBe(true)
    expect(keep.has(44)).toBe(true)
  })

  it('stays evenly spaced after ten rounds of splicing', () => {
    // The ratchet in #71: ten sessions of five commits each. Re-snapping every
    // round has to stay stable — erosion would pile the survivors up at one end.
    let keep = [0, 5, 10, 14, 19]
    let total = 20
    for (let round = 0; round < 10; round++) {
      const next = resampleIndices(keep, total, total + 5, 5)
      total += 5
      keep = [...next].sort((a, b) => a - b)
      expect(keep.length).toBeLessThanOrEqual(6)
    }
    expect(keep[keep.length - 1]).toBe(total - 1)
    const gaps = keep.slice(1).map((v, i) => v - keep[i])
    // a full analysis of 70 commits at target 5 spaces them 17 apart
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2 * Math.ceil(total / 5))
  })
})
