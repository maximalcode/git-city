import { createHash } from 'crypto'
import { constants, type Stats } from 'fs'
import { lstat, open, realpath } from 'fs/promises'
import { isAbsolute, join, relative, sep } from 'path'
import type { RehearsalConflict, RehearsalIdentity } from '../shared/types'
import { parseConflictSegments } from './git/conflicts'
import { runGit } from './git/exec'
import { withRepoLock } from './git/queue'
import { rehearsalContinue, rehearsalShow } from './rehearsal'

/** One queue for reads, edits and Continue, distinct from the original worktree. */
export function withRehearsal<T>(
  identity: RehearsalIdentity,
  action: () => Promise<T>
): Promise<T> {
  return withRepoLock(`rehearsal:${identity?.repository_id}:${identity?.id}`, action)
}

async function sandboxFile(
  tool: string | undefined,
  identity: RehearsalIdentity,
  path: string
): Promise<{ root: string; absolute: string; fileStat: Stats }> {
  const current = await rehearsalShow(tool, identity)
  if (current.kind !== 'report') throw new Error(current.message)
  if (current.report.outcome !== 'stopped' || !current.report.sandbox)
    throw new Error('Conflict editing requires a stopped rehearsal with a retained sandbox.')
  if (
    typeof path !== 'string' ||
    !path ||
    isAbsolute(path) ||
    /[\\\0:]/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..' || p.toLowerCase() === '.git')
  )
    throw new Error('Choose a relative conflict file inside this sandbox.')
  const root = await realpath(current.report.sandbox)
  const origin = await realpath(identity.origin_worktree)
  const inside = (parent: string, child: string): boolean => {
    const rel = relative(parent, child)
    return !rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  }
  if (inside(origin, root) || inside(root, origin))
    throw new Error('Sandbox and original worktree must be separate.')
  const gitDirectory = await realpath(
    (await runGit(root, ['rev-parse', '--absolute-git-dir'])).trim()
  )
  const commonDirectory = await realpath(
    (await runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  )
  if (!inside(root, gitDirectory) || !inside(root, commonDirectory))
    throw new Error('Sandbox Git metadata must remain inside the sandbox.')
  let absolute = root
  for (const part of path.split('/')) {
    absolute = join(absolute, part)
    const stat = await lstat(absolute)
    if (stat.isSymbolicLink()) throw new Error('Symlink paths cannot be edited in the sandbox.')
  }
  const fileStat = await lstat(absolute)
  if ((await realpath(absolute)) !== absolute)
    throw new Error('Sandbox path changed; reopen the conflict.')
  if (!fileStat.isFile() || fileStat.nlink !== 1)
    throw new Error('Only regular sandbox files without hard links can be edited.')
  const unmerged = await runGit(root, ['diff', '--name-only', '--diff-filter=U', '-z'])
  if (!unmerged.split('\0').includes(path))
    throw new Error('This file is no longer an unresolved sandbox conflict. Refresh the report.')
  return { root, absolute, fileStat }
}

const revision = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export async function readRehearsalConflict(
  tool: string | undefined,
  identity: RehearsalIdentity,
  path: string
): Promise<RehearsalConflict> {
  return withRehearsal(identity, async () => {
    const { absolute, fileStat } = await sandboxFile(tool, identity, path)
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (stat.dev !== fileStat.dev || stat.ino !== fileStat.ino)
        throw new Error('Sandbox file was replaced during access. Reload it.')
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Only regular sandbox files without hard links can be edited.')
      const bytes = await file.readFile()
      const binary = bytes.includes(0)
      return {
        revision: revision(bytes),
        file: {
          path,
          binary,
          segments: binary ? [] : parseConflictSegments(bytes.toString('utf8'))
        }
      }
    } finally {
      await file.close()
    }
  })
}

export async function saveRehearsalConflict(
  tool: string | undefined,
  identity: RehearsalIdentity,
  path: string,
  expected: string,
  text: string
): Promise<void> {
  return withRehearsal(identity, async () => {
    if (typeof text !== 'string' || typeof expected !== 'string')
      throw new Error('A reviewed text buffer is required.')
    const { root, absolute, fileStat } = await sandboxFile(tool, identity, path)
    // Open without truncation and compare the exact bytes in the main process.
    const file = await open(absolute, constants.O_RDWR | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (stat.dev !== fileStat.dev || stat.ino !== fileStat.ino)
        throw new Error('Sandbox file was replaced during access. Reload it.')
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Only regular sandbox files without hard links can be edited.')
      await sandboxFile(tool, identity, path)
      const now = await lstat(absolute)
      if (now.ino !== stat.ino || now.dev !== stat.dev || now.nlink !== 1)
        throw new Error('File was replaced. Nothing was overwritten; reload it.')
      const bytes = await file.readFile()
      if (bytes.includes(0))
        throw new Error('Binary conflicts require whole-file resolution outside this text editor.')
      if (revision(bytes) !== expected)
        throw new Error(
          'File changed on disk. Nothing was overwritten. Reload and review the current content.'
        )
      await file.write(Buffer.from(text), 0, Buffer.byteLength(text), 0)
      await file.truncate(Buffer.byteLength(text))
    } finally {
      await file.close()
    }
    await sandboxFile(tool, identity, path)
    await runGit(root, ['--literal-pathspecs', 'add', '--', path])
  })
}

export const continueRehearsal = (
  tool: string | undefined,
  identity: RehearsalIdentity
): ReturnType<typeof rehearsalContinue> =>
  withRehearsal(identity, () => rehearsalContinue(tool, identity))
