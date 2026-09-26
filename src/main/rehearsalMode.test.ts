import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { runGit } from './git/exec'
import { rehearsalMode } from './rehearsalMode'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'git-city-mode-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  await runGit(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '--allow-empty',
    '-m',
    'base'
  ])
  const linked = join(root, 'linked')
  await runGit(root, ['worktree', 'add', '-b', 'linked', linked])
  return { root, linked, file: join(root, 'preferences', 'rehearsal-modes.json') }
}
it('defaults new repositories to Automatic and persists a shared choice after reopening from either worktree', async () => {
  const { root, linked, file } = await fixture()
  expect((await rehearsalMode(file, true, linked))?.mode).toBe('automatic')
  const chosen = await rehearsalMode(file, true, root, [], 'ask')
  expect(await rehearsalMode(file, false, linked)).toEqual(chosen)
  await rehearsalMode(file, false, linked, [], 'off')
  expect((await rehearsalMode(file, false, root))?.mode).toBe('off')
})
it('imports known repositories once by common identity, including when first opened in another worktree', async () => {
  const { root, linked, file } = await fixture()
  expect((await rehearsalMode(file, true, linked, [root]))?.mode).toBeNull()
  expect((await rehearsalMode(file, false, root))?.mode).toBeNull()
  await rehearsalMode(file, true, linked, [], 'automatic')
  expect((await rehearsalMode(file, true, root, [root]))?.mode).toBe('automatic')
})
it('preserves unresolved legacy paths until the repository becomes available', async () => {
  const first = await fixture()
  const second = await fixture()
  const missing = join(first.root, 'later')
  expect((await rehearsalMode(first.file, true, first.root, [missing]))?.mode).toBe('automatic')
  const { rename } = await import('fs/promises')
  await rename(second.root, missing)
  expect((await rehearsalMode(first.file, true, missing))?.mode).toBeNull()
})
it('stays hidden before internal enablement but never silently disables a saved mode when the tool disappears', async () => {
  const { root, file } = await fixture()
  expect(await rehearsalMode(file, false, root)).toBeNull()
  await rehearsalMode(file, true, root)
  expect((await rehearsalMode(file, false, root))?.mode).toBe('automatic')
})
it.each(['{broken', '{"schema":2}', '{"schema":1,"legacy":[],"repositories":{"key":"surprise"}}'])(
  'refuses corrupt or incompatible preferences without overwriting them: %s',
  async (contents) => {
    const { root, file } = await fixture()
    await rehearsalMode(file, true, root)
    await writeFile(file, contents)
    await expect(rehearsalMode(file, false, root, [], 'off')).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(contents)
  }
)
