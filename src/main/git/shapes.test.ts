import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { analyzeRepo } from './analyze'
import { getWorkingStatus } from './status'
import { makeTempRepo } from './fixtures'

/**
 * Repo shapes we did not build the app on.
 *
 * Going public means strangers point this at repositories nobody here has
 * seen, so these cover the states a real checkout drifts into — a renamed
 * default branch, a detached HEAD, an interrupted merge or rebase, awkward
 * filenames, a shallow clone. Each one asserts that analysis and status come
 * back coherent rather than throwing or silently losing files.
 */

/** NTFS forbids characters POSIX allows, and caps a path at 260 characters. */
const WINDOWS = process.platform === 'win32'

const created: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

const silent = (): void => {}
const analyze = (path: string) => analyzeRepo(path, 20, silent)

describe('repo shapes', () => {
  it('analyzes a repo whose default branch is not main', async () => {
    const repo = makeTempRepo('git-city-master-')
    created.push(repo.path)
    repo.git('branch', '-m', 'master')
    repo.write('a.ts', 'let x = 1\n')
    repo.commitAll('first')

    const result = await analyze(repo.path)
    expect(result.snapshots.length).toBeGreaterThan(0)
    expect(result.snapshots.at(-1)?.files.map((f) => f.path)).toContain('a.ts')

    const status = await getWorkingStatus(repo.path)
    expect(status.branch).toBe('master')
  })

  it('handles a detached HEAD without losing the file list', async () => {
    const repo = makeTempRepo('git-city-detached-')
    created.push(repo.path)
    repo.write('a.ts', 'let x = 1\n')
    repo.commitAll('first')
    repo.write('b.ts', 'let y = 2\n')
    repo.commitAll('second')
    const first = repo.git('rev-parse', 'HEAD~1').trim()
    repo.git('checkout', '--detach', first)

    const result = await analyze(repo.path)
    // detached at the first commit: b.ts is not in this history yet
    expect(result.snapshots.at(-1)?.files.map((f) => f.path)).toEqual(['a.ts'])

    const status = await getWorkingStatus(repo.path)
    expect(status).toBeTruthy()
  })

  it('reports status while a merge is in progress', async () => {
    const repo = makeTempRepo('git-city-merging-')
    created.push(repo.path)
    repo.write('conflict.txt', 'base\n')
    repo.commitAll('base')
    repo.git('checkout', '-b', 'other')
    repo.write('conflict.txt', 'theirs\n')
    repo.commitAll('theirs')
    repo.git('checkout', 'main')
    repo.write('conflict.txt', 'ours\n')
    repo.commitAll('ours')
    // conflicting merge: leaves the repo mid-merge
    try {
      repo.git('merge', 'other')
    } catch {
      /* expected to conflict */
    }

    const status = await getWorkingStatus(repo.path)
    expect(status.opState).toBe('merge')
    expect(status.files.filter((f) => f.conflicted).map((f) => f.path)).toContain('conflict.txt')
    // analysis must still work while the tree is in a merge state
    await expect(analyze(repo.path)).resolves.toBeTruthy()
  })

  it('reports status while an interactive rebase is in progress', async () => {
    const repo = makeTempRepo('git-city-rebasing-')
    created.push(repo.path)
    repo.write('f.txt', 'one\n')
    repo.commitAll('one')
    repo.git('checkout', '-b', 'topic')
    repo.write('f.txt', 'topic\n')
    repo.commitAll('topic change')
    repo.git('checkout', 'main')
    repo.write('f.txt', 'main\n')
    repo.commitAll('main change')
    repo.git('checkout', 'topic')
    try {
      repo.git('rebase', 'main')
    } catch {
      /* expected to conflict and stop mid-rebase */
    }

    const status = await getWorkingStatus(repo.path)
    expect(status).toBeTruthy()
    await expect(analyze(repo.path)).resolves.toBeTruthy()
  })

  it('keeps filenames with spaces, unicode and quotes intact', async () => {
    const repo = makeTempRepo('git-city-oddnames-')
    created.push(repo.path)
    const names = [
      'a file with spaces.ts',
      'ünïcode-Ω.ts',
      "quo'te.ts",
      'ümlaut dir/nested file.ts'
    ]
    for (const name of names) repo.write(name, 'x\n')
    repo.commitAll('odd names')

    const result = await analyze(repo.path)
    const paths = result.snapshots.at(-1)?.files.map((f) => f.path) ?? []
    for (const name of names) expect(paths).toContain(name)

    // A double quote is what git actually quotes in its output, so it is the
    // name worth asserting — but NTFS forbids it outright, so on Windows the
    // oddest legal stand-in is a name that still needs quoting for the shell.
    const tricky = WINDOWS ? 'another odd name!.ts' : 'another odd "name".ts'
    repo.write(tricky, 'y\n')
    const status = await getWorkingStatus(repo.path)
    expect(status.files.map((f) => f.path)).toContain(tricky)
  })

  it('analyzes a deeply nested tree with very long paths', async () => {
    const repo = makeTempRepo('git-city-deep-')
    created.push(repo.path)
    // 20 levels either way; the segments shrink on Windows because the whole
    // path has to clear MAX_PATH (260) — git there refuses to write the file
    // at all without core.longpaths, which is an OS limit rather than
    // something the analyzer could cope with.
    const pad = 'x'.repeat(WINDOWS ? 1 : 8)
    const deep = Array.from({ length: 20 }, (_, i) => `level${i}-${pad}`).join('/')
    repo.write(`${deep}/leaf.ts`, 'deep\n')
    repo.commitAll('deep tree')

    const result = await analyze(repo.path)
    const paths = result.snapshots.at(-1)?.files.map((f) => f.path) ?? []
    expect(paths).toContain(`${deep}/leaf.ts`)
  })

  it('analyzes a shallow clone', async () => {
    const source = makeTempRepo('git-city-shallow-src-')
    created.push(source.path)
    for (let i = 0; i < 5; i++) {
      source.write(`f${i}.ts`, `let v = ${i}\n`)
      source.commitAll(`commit ${i}`)
    }
    const dir = tempDir('git-city-shallow-dst-')
    const dest = join(dir, 'clone')
    execFileSync('git', ['clone', '--depth', '1', `file://${source.path}`, dest], { stdio: 'pipe' })

    const result = await analyze(dest)
    expect(result.snapshots.length).toBeGreaterThan(0)
    // a depth-1 clone only knows the tip commit
    expect(result.info.commitCount).toBe(1)
    expect(result.snapshots.at(-1)?.files.length).toBe(5)
  })

  it('analyzes a repo with a submodule without descending into it', async () => {
    const sub = makeTempRepo('git-city-submodule-inner-')
    created.push(sub.path)
    sub.write('inner.ts', 'inner\n')
    sub.commitAll('inner')

    const outer = makeTempRepo('git-city-submodule-outer-')
    created.push(outer.path)
    outer.write('outer.ts', 'outer\n')
    outer.commitAll('outer')
    outer.git(
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      `file://${sub.path}`,
      'vendor/inner'
    )
    outer.commitAll('add submodule')

    const result = await analyze(outer.path)
    const paths = result.snapshots.at(-1)?.files.map((f) => f.path) ?? []
    expect(paths).toContain('outer.ts')
    // the submodule is a gitlink, not a tree of files to draw
    expect(paths.some((p) => p.startsWith('vendor/inner/'))).toBe(false)
  })

  it('handles many files in a single directory', async () => {
    const repo = makeTempRepo('git-city-wide-')
    created.push(repo.path)
    for (let i = 0; i < 1200; i++) repo.write(`flat/f${i}.ts`, `export const v${i} = ${i}\n`)
    repo.commitAll('wide directory')

    const result = await analyze(repo.path)
    expect(result.snapshots.at(-1)?.files.length).toBe(1200)
  })
})
