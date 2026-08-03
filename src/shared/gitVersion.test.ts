import { describe, expect, it } from 'vitest'
import { describeGitVersion, parseGitVersion, tooOldMessage } from './gitVersion'

describe('parseGitVersion', () => {
  it('reads a plain version', () => {
    expect(parseGitVersion('git version 2.39.3')).toEqual([2, 39])
  })

  it('reads the Apple Git suffix macOS ships', () => {
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)')).toEqual([2, 39])
  })

  it('reads the windows build suffix', () => {
    expect(parseGitVersion('git version 2.45.2.windows.1')).toEqual([2, 45])
  })

  it('returns null for something that is not a version at all', () => {
    expect(parseGitVersion('git: command not found')).toBeNull()
    expect(parseGitVersion('')).toBeNull()
  })
})

describe('describeGitVersion', () => {
  it('accepts the minimum exactly', () => {
    expect(describeGitVersion('git version 2.31.0').supported).toBe(true)
  })

  it('rejects one minor below the minimum', () => {
    expect(describeGitVersion('git version 2.30.1').supported).toBe(false)
  })

  it('rejects an older major', () => {
    expect(describeGitVersion('git version 1.9.5').supported).toBe(false)
  })

  it('accepts a newer major without knowing anything about it', () => {
    expect(describeGitVersion('git version 3.0.0').supported).toBe(true)
  })

  it('accepts an unparseable version rather than refusing to start on a guess', () => {
    const v = describeGitVersion('git version wibble')
    expect(v.parts).toBeNull()
    expect(v.supported).toBe(true)
  })
})

describe('tooOldMessage', () => {
  it('names the version the user actually has, and the fix', () => {
    const msg = tooOldMessage(describeGitVersion('git version 2.30.1'))
    expect(msg).toContain('2.31')
    expect(msg).toContain('you have 2.30')
    expect(msg).toContain('git-scm.com')
  })
})
