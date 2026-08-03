import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { cloneFailureMessage, destinationFor, repoNameFromUrl, sameRemote } from './clone'

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

describe('sameRemote', () => {
  it('sees through the ways one URL gets written', () => {
    const url = 'https://github.com/expressjs/express'
    expect(sameRemote(url, 'https://github.com/expressjs/express.git')).toBe(true)
    expect(sameRemote(url, 'https://github.com/expressjs/express/')).toBe(true)
    expect(sameRemote(url, 'https://GitHub.com/expressjs/express')).toBe(true)
  })

  it('does not confuse a fork with its upstream', () => {
    // the collision that matters: same repo name, different owner
    expect(
      sameRemote('https://github.com/expressjs/express', 'https://github.com/me/express')
    ).toBe(false)
  })
})

const created: string[] = []
function tempClonesDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-city-clones-'))
  created.push(dir)
  return dir
}
/** A directory that looks like a clone to `existsSync(dest/.git)`. */
function fakeClone(clonesDir: string, name: string): string {
  const dest = join(clonesDir, name)
  mkdirSync(join(dest, '.git'), { recursive: true })
  writeFileSync(join(dest, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return dest
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

/**
 * The fork-and-upstream collision. Both are called "express", and reusing the
 * wrong one means the user commits and pushes against an origin nothing on
 * screen ever named (#25).
 */
describe('destinationFor', () => {
  const upstream = 'https://github.com/expressjs/express'
  const fork = 'https://github.com/me/express'

  it('uses the plain name when nothing is there yet', async () => {
    const dir = tempClonesDir()
    const { dest, reuse } = await destinationFor(upstream, dir, async () => null)
    expect(dest).toBe(join(dir, 'express'))
    expect(reuse).toBe(false)
  })

  it('reuses a clone whose origin really is the requested URL', async () => {
    const dir = tempClonesDir()
    fakeClone(dir, 'express')
    const { dest, reuse } = await destinationFor(upstream, dir, async () => upstream)
    expect(dest).toBe(join(dir, 'express'))
    expect(reuse).toBe(true)
  })

  it('reuses across the .git spelling difference', async () => {
    const dir = tempClonesDir()
    fakeClone(dir, 'express')
    const { reuse } = await destinationFor(upstream, dir, async () => `${upstream}.git`)
    expect(reuse).toBe(true)
  })

  it('clones a fork alongside its upstream instead of opening the upstream', async () => {
    const dir = tempClonesDir()
    fakeClone(dir, 'express')
    const { dest, reuse } = await destinationFor(fork, dir, async () => upstream)
    expect(dest).toBe(join(dir, 'express-2'))
    expect(reuse).toBe(false)
  })

  it('keeps walking past several occupied names', async () => {
    const dir = tempClonesDir()
    fakeClone(dir, 'express')
    fakeClone(dir, 'express-2')
    const { dest } = await destinationFor(fork, dir, async () => upstream)
    expect(dest).toBe(join(dir, 'express-3'))
  })

  it('finds the fork on a later attempt rather than cloning it again', async () => {
    const dir = tempClonesDir()
    fakeClone(dir, 'express')
    fakeClone(dir, 'express-2')
    const origins: Record<string, string> = {
      [join(dir, 'express')]: upstream,
      [join(dir, 'express-2')]: fork
    }
    const { dest, reuse } = await destinationFor(fork, dir, async (d) => origins[d] ?? null)
    expect(dest).toBe(join(dir, 'express-2'))
    expect(reuse).toBe(true)
  })

  it('does not reuse a clone whose origin cannot be read', async () => {
    // half-cloned, or pointed somewhere we cannot see — not safe to hand back
    const dir = tempClonesDir()
    fakeClone(dir, 'express')
    const { dest, reuse } = await destinationFor(upstream, dir, async () => null)
    expect(dest).toBe(join(dir, 'express-2'))
    expect(reuse).toBe(false)
  })
})

describe('cloneFailureMessage', () => {
  it('explains the private-or-missing case instead of quoting git', () => {
    const msg = cloneFailureMessage(
      "fatal: could not read Username for 'https://github.com': No such device or address"
    )
    expect(msg).toContain('private')
    expect(msg).not.toContain('Username')
  })

  it('recognises a repository that is not there', () => {
    expect(cloneFailureMessage("fatal: repository 'https://x/y' not found")).toContain('private')
  })

  it('names the network as the cause when it is', () => {
    expect(cloneFailureMessage('fatal: unable to access: Could not resolve host: githb.com')).toBe(
      'Could not reach that host. Check the URL and your network connection.'
    )
  })

  it('never leaks the internal clones path in the fallback', () => {
    const msg = cloneFailureMessage(
      "fatal: destination path '/Users/you/Library/Application Support/git-city/clones/x' exists"
    )
    expect(msg).not.toContain('Application Support')
  })
})
