import { describe, expect, it } from 'vitest'
import { DENSE_FILE_COUNT, estimateSeconds, repoWarning } from './repoScale'
import { MAX_DRAWN_FILES } from '../layout/cap'

describe('estimateSeconds', () => {
  it('reproduces the analysis point it was derived from', () => {
    // microsoft/TypeScript: 14,271 commits took 129.6s (#12)
    expect(estimateSeconds(14_271)).toBeCloseTo(128.4, 0)
  })

  it('is zero for an empty repo', () => {
    expect(estimateSeconds(0)).toBe(0)
  })

  /**
   * The scene build used to be missing from this entirely, so a big tree with
   * a short history was promised an instant open and then spent ten seconds
   * building (#12).
   */
  it('counts the scene build, not just the history replay', () => {
    // a shallow monorepo clone: one commit, so the old estimate said ~0
    expect(estimateSeconds(1, 20_000)).toBeGreaterThan(10)
    expect(estimateSeconds(1, 0)).toBeCloseTo(0.009, 3)
  })

  it('stops charging for files past the draw cap, because we never draw them', () => {
    const atCap = estimateSeconds(0, MAX_DRAWN_FILES)
    expect(estimateSeconds(0, 81_368)).toBe(atCap)
    expect(estimateSeconds(0, 1_000_000)).toBe(atCap)
  })
})

describe('repoWarning', () => {
  it('says nothing about a repo that opens comfortably', () => {
    expect(repoWarning({ commits: 500, files: 800 })).toBeNull()
    expect(repoWarning({ commits: 2_000, files: 5_000 })).toBeNull()
  })

  it('warns about a long history even when the tree is small', () => {
    const w = repoWarning({ commits: 20_000, files: 900 })
    expect(w).not.toBeNull()
    expect(w!.dense).toBe(false)
    expect(w!.streetless).toBe(false)
  })

  it('warns about a huge tree even when the history is short', () => {
    // a shallow clone of a monorepo: draws badly, replays fast
    const w = repoWarning({ commits: 1, files: 40_000 })
    expect(w).not.toBeNull()
    expect(w!.dense).toBe(true)
    expect(w!.wait).toBe('up to a minute')
  })

  it('flags the streetless case only once the roads are really gone', () => {
    expect(repoWarning({ commits: 1, files: DENSE_FILE_COUNT })!.streetless).toBe(false)
    expect(repoWarning({ commits: 1, files: 81_368 })!.streetless).toBe(true)
  })

  it('scales its wording with the history length', () => {
    expect(repoWarning({ commits: 5_000, files: 1 })!.wait).toBe('up to a minute')
    expect(repoWarning({ commits: 14_271, files: 1 })!.wait).toBe('a couple of minutes')
    expect(repoWarning({ commits: 40_000, files: 1 })!.wait).toBe('several minutes')
    expect(repoWarning({ commits: 200_000, files: 1 })!.wait).toMatch(/over ten minutes/)
  })

  it('does not interrupt for a wait nobody would notice', () => {
    expect(repoWarning({ commits: 2_700, files: 100 })).toBeNull()
  })

  /** The dialog has to say the scene is a subset *before* the wait, not after. */
  describe('the draw cap', () => {
    it('is not mentioned for a repo that fits', () => {
      const w = repoWarning({ commits: 20_000, files: 900 })!
      expect(w.capped).toBe(false)
      expect(w.drawn).toBe(900)
    })

    it('reports the cap and the drawn count for a monorepo', () => {
      const w = repoWarning({ commits: 14_271, files: 81_368 })!
      expect(w.capped).toBe(true)
      expect(w.drawn).toBe(MAX_DRAWN_FILES)
    })

    it('does not cap at exactly the ceiling', () => {
      expect(repoWarning({ commits: 1, files: MAX_DRAWN_FILES })!.capped).toBe(false)
    })
  })
})
