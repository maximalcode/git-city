import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

/**
 * Test-only fixture helpers (imported exclusively from *.test.ts files, so
 * they never end up in the app bundle).
 */

export interface FixtureRepo {
  path: string
  git(...args: string[]): string
  write(rel: string, content: string): void
  commitAll(message: string): void
}

function makeGit(cwd: string): (...args: string[]) => string {
  return (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        // keep byte-exact assertions independent of the machine's autocrlf
        '-c',
        'core.autocrlf=false',
        ...args
      ],
      { cwd, stdio: 'pipe' }
    ).toString()
}

export function makeTempRepo(prefix = 'git-city-fix-'): FixtureRepo {
  const path = mkdtempSync(join(tmpdir(), prefix))
  const git = makeGit(path)
  git('init', '-b', 'main')
  // repo-local, so the code under test sees it too (not just fixture commands)
  git('config', 'core.autocrlf', 'false')
  const write = (rel: string, content: string): void => {
    const abs = join(path, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  const commitAll = (message: string): void => {
    git('add', '-A')
    git('commit', '-m', message)
  }
  return { path, git, write, commitAll }
}

export interface RepoPair {
  /** bare origin repo path */
  origin: string
  a: FixtureRepo
  b: FixtureRepo
}

/**
 * A bare origin with two clones that both track origin/main — the standard
 * fixture for push/pull/fetch/diverge tests, entirely offline via file://.
 */
export function makeRepoPair(prefix = 'git-city-pair-'): RepoPair {
  const base = mkdtempSync(join(tmpdir(), prefix))
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'pipe' })

  const seed = makeTempRepo(`${prefix}seed-`)
  seed.write('README.md', 'hello\n')
  seed.commitAll('initial')
  seed.git('remote', 'add', 'origin', origin)
  seed.git('push', '-u', 'origin', 'main')

  const cloneTo = (name: string): FixtureRepo => {
    const path = join(base, name)
    // -c on the clone itself so the very first checkout is not CRLF-dirtied
    execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', origin, path], { stdio: 'pipe' })
    const git = makeGit(path)
    git('config', 'core.autocrlf', 'false')
    const write = (rel: string, content: string): void => {
      const abs = join(path, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    const commitAll = (message: string): void => {
      git('add', '-A')
      git('commit', '-m', message)
    }
    return { path, git, write, commitAll }
  }

  return { origin, a: cloneTo('clone-a'), b: cloneTo('clone-b') }
}

/**
 * A FRESH clone of an origin that already has extra branches — the real-world
 * case where every branch except the default is a remote-tracking ref
 * (refs/remotes/origin/*), not a local branch.
 */
export function makeCloneWithRemoteBranches(names: string[], prefix = 'git-city-rb-'): FixtureRepo {
  const base = mkdtempSync(join(tmpdir(), prefix))
  const origin = join(base, 'origin.git')
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'pipe' })

  const seed = makeTempRepo(`${prefix}seed-`)
  seed.write('README.md', 'hello\n')
  seed.commitAll('initial')
  seed.git('remote', 'add', 'origin', origin)
  seed.git('push', '-u', 'origin', 'main')
  for (const n of names) {
    seed.git('switch', '-c', n)
    seed.write(`${n.replace(/\//g, '_')}.txt`, `${n}\n`)
    seed.commitAll(`${n} work`)
    seed.git('push', '-u', 'origin', n)
    seed.git('switch', 'main')
  }

  const dest = join(base, 'clone')
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', origin, dest], { stdio: 'pipe' })
  const git = makeGit(dest)
  git('config', 'core.autocrlf', 'false')
  const write = (rel: string, content: string): void => {
    const abs = join(dest, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  const commitAll = (message: string): void => {
    git('add', '-A')
    git('commit', '-m', message)
  }
  return { path: dest, git, write, commitAll }
}
