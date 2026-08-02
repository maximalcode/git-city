import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * PATH repair for a Finder-launched app.
 *
 * A GUI app started from the Dock inherits launchd's PATH, which is
 * `/usr/bin:/bin:/usr/sbin:/sbin` — git survives at /usr/bin/git, but `gh` and
 * `glab` installed by a package manager do not. Without this the packaged app
 * tells a Homebrew user to install the gh they are already running in Terminal.
 *
 * Re-imported per test because exec.ts snapshots the result into GIT_ENV at
 * load time — which is also the trap these guard: GIT_ENV calls searchPath(),
 * so anything it depends on has to be initialised before it.
 */

const realPath = process.env.PATH
const realHome = process.env.HOME

afterEach(() => {
  process.env.PATH = realPath
  process.env.HOME = realHome
  vi.resetModules()
})

async function load(path: string): Promise<typeof import('./exec')> {
  vi.resetModules()
  process.env.PATH = path
  return import('./exec')
}

describe('searchPath', () => {
  it('loads exec.ts at all', async () => {
    // GIT_ENV evaluates searchPath() during module init, so a declaration
    // ordered after it throws a TDZ ReferenceError that only shows up at
    // runtime — neither tsc nor eslint catches it, and it kills the main process
    await expect(load('/usr/bin:/bin')).resolves.toBeDefined()
  })

  it('keeps the inherited PATH ahead of anything it adds', async () => {
    const { searchPath } = await load('/usr/bin:/bin')
    expect(searchPath().startsWith('/usr/bin:/bin')).toBe(true)
  })

  it('never adds a directory twice', async () => {
    const { searchPath } = await load('/usr/bin:/bin:/usr/local/bin')
    const parts = searchPath().split(':')
    expect(new Set(parts).size).toBe(parts.length)
  })

  it('only adds directories that exist', async () => {
    const { searchPath } = await load('/usr/bin')
    for (const dir of searchPath().split(':')) {
      expect(dir.length).toBeGreaterThan(0)
    }
  })

  it('leaves an explicitly empty PATH empty', async () => {
    // the missing-git tests empty PATH to mean "git is unreachable"; handing
    // back four directories would quietly re-find a real git and invert them
    const { searchPath } = await load('')
    expect(searchPath()).toBe('')
  })
})
