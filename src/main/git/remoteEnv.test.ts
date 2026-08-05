import { rmSync } from 'fs'
import { simpleGit } from 'simple-git'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempRepo } from './fixtures'
import { remoteEnv } from './remoteEnv'

/**
 * Every variable simple-git's block-unsafe-operations plugin objects to. It
 * throws on these rather than ignoring them, so one of them surviving into the
 * environment breaks fetch, pull, push and clone outright (#44).
 *
 * Enumerated by probing the vendored simple-git, not read off its docs.
 */
const BLOCKED_BY_SIMPLE_GIT = [
  'PAGER',
  'GIT_PAGER',
  'PREFIX',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_EXEC_PATH',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_COUNT',
  'GIT_PROXY_COMMAND',
  'GIT_EXTERNAL_DIFF',
  'GIT_TEMPLATE_DIR',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_EDITOR',
  'EDITOR',
  'GIT_SEQUENCE_EDITOR'
]

describe('remoteEnv', () => {
  it('passes none of the variables simple-git refuses to run with', () => {
    const source: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    for (const key of BLOCKED_BY_SIMPLE_GIT) source[key] = 'set-by-the-user'
    const env = remoteEnv(source)
    for (const key of BLOCKED_BY_SIMPLE_GIT) expect(env).not.toHaveProperty(key)
  })

  it('keeps what git needs to reach a remote', () => {
    const env = remoteEnv({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      HTTPS_PROXY: 'http://proxy:8080'
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/Users/me')
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/agent.sock')
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080')
  })

  it('keeps the Windows equivalents of HOME', () => {
    const env = remoteEnv({ USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData' })
    expect(env.USERPROFILE).toBe('C:\\Users\\me')
    expect(env.APPDATA).toBe('C:\\Users\\me\\AppData')
  })

  it('always disables the terminal prompt', () => {
    // the GUI has no terminal to answer it, so a prompt is an infinite hang
    expect(remoteEnv({}).GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('drops anything not on the list', () => {
    const env = remoteEnv({ SOME_TOOL_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret' })
    expect(env).not.toHaveProperty('SOME_TOOL_TOKEN')
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })

  it('lets the caller override PATH with the augmented search path', () => {
    const env = remoteEnv({ PATH: '/usr/bin' }, { PATH: '/usr/bin:/opt/homebrew/bin' })
    expect(env.PATH).toBe('/usr/bin:/opt/homebrew/bin')
  })

  it('omits a variable that is absent rather than setting it undefined', () => {
    expect(remoteEnv({ PATH: '/usr/bin' })).not.toHaveProperty('HOME')
  })
})

/**
 * The unit tests above assert against a hard-coded list of what simple-git
 * objects to. This one asks simple-git itself, so a version bump that adds a
 * category fails here rather than in a user's fetch.
 */
describe('remoteEnv against the real simple-git', () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })
  const repoWithACommit = (prefix: string): string => {
    const repo = makeTempRepo(prefix)
    dirs.push(repo.path)
    repo.write('a.ts', 'let x = 1\n')
    repo.commitAll('first')
    return repo.path
  }

  it('lets a remote command run with the whole blocked set exported', async () => {
    const path = repoWithACommit('git-city-remote-env-')
    const hostile: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME }
    for (const key of BLOCKED_BY_SIMPLE_GIT) hostile[key] = 'set-by-the-user'

    const git = simpleGit({ baseDir: path }).env(remoteEnv(hostile))
    await expect(git.raw(['rev-parse', '--git-dir'])).resolves.toBeTruthy()
  })

  it('proves that environment really would have broken it', async () => {
    // one exported PAGER is enough — this is the failure every user with
    // `export PAGER=less` in their profile hit on every sync (#44)
    const path = repoWithACommit('git-city-remote-env-bad-')
    const git = simpleGit({ baseDir: path }).env({
      PATH: process.env.PATH ?? '',
      PAGER: 'less'
    })
    await expect(git.raw(['rev-parse', '--git-dir'])).rejects.toThrow(/not permitted/i)
  })
})
