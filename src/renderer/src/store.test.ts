import { describe, expect, it } from 'vitest'
import type { WorkingStatus } from '../../shared/types'
import { statusFingerprint, useStore } from './store'

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
