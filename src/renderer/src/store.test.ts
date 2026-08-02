import { describe, expect, it } from 'vitest'
import type { WorkingStatus } from '../../shared/types'
import { isLiveState, statusFingerprint, useStore } from './store'

function baseStatus(): WorkingStatus {
  return {
    branch: 'feature/x',
    detachedAt: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    opState: 'none',
    stashCount: 0,
    remotes: [{ name: 'origin', url: 'https://example.invalid/repo.git' }],
    headHash: 'abc123def456'
  }
}

describe('statusFingerprint', () => {
  it('is stable for identical statuses', () => {
    expect(statusFingerprint(baseStatus())).toBe(statusFingerprint(baseStatus()))
  })

  it('is empty for null', () => {
    expect(statusFingerprint(null)).toBe('')
  })

  it('changes when upstream appears (the publish → Push button regression)', () => {
    const before = baseStatus()
    const after = { ...baseStatus(), upstream: 'origin/feature/x' }
    // Publishing a fresh branch changes ONLY upstream: head, branch, ahead/behind,
    // files are all identical. The fingerprint must still differ.
    expect(statusFingerprint(before)).not.toBe(statusFingerprint(after))
  })

  it('changes when the stash count changes', () => {
    const before = baseStatus()
    const after = { ...baseStatus(), stashCount: 2 }
    expect(statusFingerprint(before)).not.toBe(statusFingerprint(after))
  })

  it('still changes on file status changes', () => {
    const before = baseStatus()
    const after: WorkingStatus = {
      ...baseStatus(),
      files: [{ path: 'a.ts', index: 'modified', worktree: 'unmodified', conflicted: false }]
    }
    expect(statusFingerprint(before)).not.toBe(statusFingerprint(after))
  })
})

describe('preferences', () => {
  it('toggleReduceMotion flips the flag', () => {
    const start = useStore.getState().reduceMotion
    useStore.getState().toggleReduceMotion()
    expect(useStore.getState().reduceMotion).toBe(!start)
    useStore.getState().toggleReduceMotion()
    expect(useStore.getState().reduceMotion).toBe(start)
  })

  it('resetPreferences returns every appearance/behaviour pref to its default', () => {
    useStore.setState({
      themeId: 'neon',
      viewMode: 'farm',
      timeOfDay: 0.12,
      showHotspots: false,
      diffSplit: true,
      reduceMotion: true,
      onboarded: true
    })
    useStore.getState().resetPreferences()
    const s = useStore.getState()
    expect(s.viewMode).toBe('city')
    expect(s.timeOfDay).toBe(0.5)
    expect(s.showHotspots).toBe(true)
    expect(s.diffSplit).toBe(false)
    expect(s.reduceMotion).toBe(false)
    expect(s.onboarded).toBe(false)
  })
})

/**
 * The window refreshAnalysis used to ask "is the user watching the newest
 * commit?" in — and why it must not ask isLiveState there.
 */
describe('isLiveState during a reanalyse', () => {
  function stateWith(snapshotHashes: string[], index: number, headHash: string) {
    return {
      analysis: { snapshots: snapshotHashes.map((hash) => ({ hash })) },
      snapshotIndex: index,
      workingStatus: { ...baseStatus(), headHash }
    } as unknown as Parameters<typeof isLiveState>[0]
  }

  it('reports "not live" once the status is refreshed but the analysis is not', () => {
    // runOp refreshes the working status before it reanalyses, so headHash is
    // already the commit just made while the analysis still ends at the previous
    // one. Reading that as "the user is browsing history" left them one snapshot
    // in the past after every single commit.
    expect(isLiveState(stateWith(['old111', 'old222'], 1, 'new333'))).toBe(false)
  })

  it('reports "live" once the analysis has caught up', () => {
    expect(isLiveState(stateWith(['old111', 'new333'], 1, 'new333abc'))).toBe(true)
  })

  it('reports "not live" when the user really is browsing history', () => {
    expect(isLiveState(stateWith(['old111', 'old222'], 0, 'old222'))).toBe(false)
  })

  it('reports "live" for a repository with no commits', () => {
    // there is no history to browse, so the Changes panel must not offer to
    // "jump to now" from a snapshot that does not exist
    expect(isLiveState(stateWith([], 0, ''))).toBe(true)
  })

  it('reports "not live" with no repository open at all', () => {
    expect(isLiveState({ analysis: null } as unknown as Parameters<typeof isLiveState>[0])).toBe(
      false
    )
  })
})
