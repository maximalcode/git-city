import { describe, expect, it } from 'vitest'
import { repoNameFromUrl } from './clone'

describe('repoNameFromUrl', () => {
  it('handles common URL shapes', () => {
    expect(repoNameFromUrl('https://github.com/expressjs/express')).toBe('express')
    expect(repoNameFromUrl('https://github.com/expressjs/express.git')).toBe('express')
    expect(repoNameFromUrl('https://github.com/expressjs/express/')).toBe('express')
    expect(repoNameFromUrl('git@github.com:owner/my-repo.git')).toBe('my-repo')
    expect(repoNameFromUrl('https://gitlab.com/group/sub/project.git')).toBe('project')
  })

  it('sanitises unsafe characters', () => {
    expect(repoNameFromUrl('https://example.com/a%20b')).toBe('a_20b')
  })
})
