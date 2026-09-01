import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { cliRunner } from './cliRunner'
import { TIMED_OUT } from './cliFailure'

/**
 * The real runner's mechanics, exercised against real child processes — none
 * of them `gh` or `glab`. The provider layer above the runner is tested with
 * fakes in `hostProvider.test.ts`; this is the half the fake replaces.
 */

const scratch = mkdtempSync(join(tmpdir(), 'git-city-clirunner-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('cliRunner', () => {
  it('resolves close → code with both streams', async () => {
    const run = cliRunner({ binary: 'git' })
    const res = await run(scratch, ['--version'])
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('git version')
    expect(res.stderr).toBe('')
    expect(res.missing).toBe(false)
  })

  it('maps ENOENT to missing rather than throwing', async () => {
    const run = cliRunner({ binary: 'git-city-no-such-cli' })
    const res = await run(scratch, ['--version'])
    expect(res.missing).toBe(true)
    expect(res.code).toBe(-1)
  })

  it('kills a child that never answers and marks the timeout (#24)', async () => {
    // node is guaranteed everywhere the tests run; a 60 s internal timer
    // hangs the child until our (shortened) clock kills it
    const run = cliRunner({ binary: process.execPath }, 400)
    const res = await run(scratch, ['-e', 'setTimeout(() => {}, 60000)'])
    expect(res.code).toBe(-1)
    expect(res.missing).toBe(false)
    expect(res.stderr).toContain(TIMED_OUT)
  })

  it('passes the shared env and the CLI env keys through to the child', async () => {
    const run = cliRunner({ binary: process.execPath, env: { GH_PAGER: 'off' } })
    const res = await run(scratch, [
      '-e',
      'process.stdout.write(`${process.env.GH_PAGER}|${process.env.GIT_TERMINAL_PROMPT}|${process.env.NO_COLOR}`)'
    ])
    expect(res.stdout).toBe('off|0|1')
  })

  it('collects stderr alongside a nonzero exit', async () => {
    const run = cliRunner({ binary: process.execPath })
    const res = await run(scratch, ['-e', 'process.stderr.write("boom"); process.exit(3)'])
    expect(res.code).toBe(3)
    expect(res.stderr).toContain('boom')
    expect(res.missing).toBe(false)
  })
})
