import { describe, it, expect } from 'vitest'
import { parseSubmoduleStatus } from './submodules'

describe('parseSubmoduleStatus', () => {
  it('parses an in-sync submodule (space flag)', () => {
    const raw = ' abc123def456 libs/foo (v1.2.0)'
    expect(parseSubmoduleStatus(raw)).toEqual([
      { sha: 'abc123def456', path: 'libs/foo', describe: 'v1.2.0', state: 'ok' }
    ])
  })

  it('flags uninitialized (-), modified (+) and conflicted (U)', () => {
    const raw = [
      '-0000000000000000000000000000000000000000 libs/uninit',
      '+1111111111111111111111111111111111111111 libs/ahead (heads/main)',
      'U2222222222222222222222222222222222222222 libs/conflict (v2)'
    ].join('\n')
    const subs = parseSubmoduleStatus(raw)
    expect(subs.map((s) => s.state)).toEqual(['uninitialized', 'modified', 'conflict'])
    expect(subs[0].describe).toBe('')
  })

  it('ignores blank lines', () => {
    expect(parseSubmoduleStatus('\n\n')).toEqual([])
  })
})
