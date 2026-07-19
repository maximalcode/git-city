import { describe, expect, it } from 'vitest'
import { isNewer, parseRelease, parseSemver } from './updates'

describe('parseSemver', () => {
  it('strips a leading v and splits into numbers', () => {
    expect(parseSemver('v0.6.0')).toEqual([0, 6, 0])
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3])
  })
  it('drops a pre-release suffix and tolerates junk', () => {
    expect(parseSemver('0.6.0-beta.1')).toEqual([0, 6, 0])
    expect(parseSemver('v2.x')).toEqual([2, 0])
  })
})

describe('isNewer', () => {
  it('is true only for a strictly higher version', () => {
    expect(isNewer('0.6.0', '0.5.0')).toBe(true)
    expect(isNewer('0.5.1', '0.5.0')).toBe(true)
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
  })
  it('is false for equal or older', () => {
    expect(isNewer('0.5.0', '0.5.0')).toBe(false)
    expect(isNewer('0.4.9', '0.5.0')).toBe(false)
    expect(isNewer('v0.5.0', '0.5.0')).toBe(false)
  })
  it('handles differing lengths', () => {
    expect(isNewer('0.5', '0.5.0')).toBe(false)
    expect(isNewer('0.5.0.1', '0.5.0')).toBe(true)
  })
})

describe('parseRelease', () => {
  const base = {
    tag_name: 'v0.6.0',
    name: 'Git City 0.6.0',
    body: 'Notes here',
    html_url: 'https://github.com/maximalcode/git-city/releases/tag/v0.6.0',
    published_at: '2026-08-01T00:00:00Z'
  }

  it('maps a newer stable release', () => {
    const u = parseRelease(base, '0.5.0')
    expect(u).not.toBeNull()
    expect(u!.version).toBe('0.6.0')
    expect(u!.name).toBe('Git City 0.6.0')
    expect(u!.url).toContain('/releases/tag/v0.6.0')
  })

  it('returns null when not newer', () => {
    expect(parseRelease(base, '0.6.0')).toBeNull()
    expect(parseRelease(base, '0.7.0')).toBeNull()
  })

  it('ignores drafts and pre-releases', () => {
    expect(parseRelease({ ...base, draft: true }, '0.5.0')).toBeNull()
    expect(parseRelease({ ...base, prerelease: true }, '0.5.0')).toBeNull()
  })

  it('returns null on a malformed payload', () => {
    expect(parseRelease({}, '0.5.0')).toBeNull()
    expect(parseRelease({ name: 'x' }, '0.5.0')).toBeNull()
  })

  it('caps very long notes', () => {
    const u = parseRelease({ ...base, body: 'x'.repeat(5000) }, '0.5.0')
    expect(u!.notes.length).toBeLessThanOrEqual(1200)
  })
})
