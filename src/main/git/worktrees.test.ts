import { describe, it, expect } from 'vitest'
import { parseWorktreeList } from './worktrees'

describe('parseWorktreeList', () => {
  it('parses multiple porcelain blocks', () => {
    const raw = [
      'worktree /repo',
      'HEAD aaaa',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD bbbb',
      'branch refs/heads/feature/x',
      ''
    ].join('\n')
    const wts = parseWorktreeList(raw)
    expect(wts).toHaveLength(2)
    expect(wts[0]).toEqual({
      path: '/repo',
      head: 'aaaa',
      branch: 'main',
      bare: false,
      detached: false,
      locked: false
    })
    expect(wts[1].branch).toBe('feature/x')
  })

  it('marks detached and locked worktrees', () => {
    const raw = ['worktree /a', 'HEAD cccc', 'detached', 'locked being edited'].join('\n')
    const [w] = parseWorktreeList(raw)
    expect(w.detached).toBe(true)
    expect(w.branch).toBeNull()
    expect(w.locked).toBe(true)
  })

  it('marks a bare main worktree', () => {
    const [w] = parseWorktreeList('worktree /bare\nbare\n')
    expect(w.bare).toBe(true)
  })

  it('handles output without a trailing blank line', () => {
    const raw = 'worktree /only\nHEAD dddd\nbranch refs/heads/dev'
    const wts = parseWorktreeList(raw)
    expect(wts).toHaveLength(1)
    expect(wts[0].branch).toBe('dev')
  })
})
