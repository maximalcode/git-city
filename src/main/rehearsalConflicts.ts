import { withRehearsalExecution } from './rehearsalProcess'
import { createHash } from 'crypto'
import { constants, type Stats } from 'fs'
import { lstat, open, realpath } from 'fs/promises'
import { isAbsolute, join, relative, sep } from 'path'
import type { RehearsalConflict, RehearsalIdentity } from '../shared/types'
import { parseConflictSegments } from './git/conflicts'
import { runGit, runGitBuffer } from './git/exec'
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
  path: string,
  inspect = false
): Promise<{ root: string; absolute: string; fileStat: Stats | null; stages: string }> {
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
  const stages = await runGit(root, ['--literal-pathspecs', 'ls-files', '-u', '-z', '--', path])
  const stageHeaders = stages.split('\0').map((entry) => entry.split('\t', 1)[0])
  const external =
    stages.length > 0 &&
    ![2, 3].every((stage) => stageHeaders.some((header) => header.endsWith(` ${stage}`)))
  if (external) {
    if (inspect) return { root, absolute: join(root, path), fileStat: null, stages }
    throw new Error(
      'Deletion or rename conflict: resolve and stage externally in the displayed sandbox, then refresh.'
    )
  }
  let absolute = root
  for (const part of path.split('/')) {
    absolute = join(absolute, part)
    const stat = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        throw new Error(
          'Sandbox path is missing or renamed. Nothing was overwritten. Resolve and stage externally, then refresh.'
        )
      throw error
    })
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
  return { root, absolute, fileStat, stages }
}

const revision = (bytes: Buffer, stages: string): string =>
  createHash('sha256').update(bytes).update(stages).digest('hex')

export async function readRehearsalConflict(
  tool: string | undefined,
  identity: RehearsalIdentity,
  path: string
): Promise<RehearsalConflict> {
  return withRehearsal(identity, async () => {
    const { root, absolute, fileStat, stages } = await sandboxFile(tool, identity, path, true)
    if (!fileStat)
      return {
        file: { path, binary: false, segments: [] },
        base_content: '',
        external: true,
        revision: revision(Buffer.alloc(0), stages)
      }
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (stat.dev !== fileStat.dev || stat.ino !== fileStat.ino)
        throw new Error('Sandbox file was replaced during access. Reload it.')
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Only regular sandbox files without hard links can be edited.')
      const bytes = await file.readFile()
      const versions = await Promise.all(
        [2, 3].map((stage) =>
          runGitBuffer(root, ['cat-file', '--filters', `--path=${path}`, `:${stage}:${path}`])
        )
      )
      if (versions.some((version) => version === null))
        throw new Error(
          'Cannot read complete conflict versions. Resolve externally in the sandbox.'
        )
      const attributes = await runGit(root, ['check-attr', '-z', 'diff', 'merge', '--', path])
      const declaredBinary = attributes
        .split('\0')
        .some((value, i) => i % 3 === 2 && value === 'unset')
      const binary =
        declaredBinary ||
        [bytes, ...versions].some(
          (version) =>
            version!.includes(0) || !Buffer.from(version!.toString('utf8')).equals(version!)
        )
      return {
        revision: revision(bytes, stages),
        base_content: binary ? '' : bytes.toString('utf8'),
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
  text: string | { side: 'ours' | 'theirs' }
): Promise<void> {
  return withRehearsal(identity, async () => {
    if (
      (typeof text !== 'string' && (!text || !['ours', 'theirs'].includes(text.side))) ||
      typeof expected !== 'string'
    )
      throw new Error('A reviewed text buffer is required.')
    const { root, absolute, fileStat, stages } = await sandboxFile(tool, identity, path)
    if (!fileStat) throw new Error('Resolve this path externally.')
    const resolved =
      typeof text === 'string'
        ? Buffer.from(text)
        : await runGitBuffer(root, [
            'cat-file',
            '--filters',
            `--path=${path}`,
            `:${text.side === 'ours' ? 2 : 3}:${path}`
          ])
    if (!resolved)
      throw new Error('Cannot read the complete version. Resolve externally in the sandbox.')
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
      if (
        typeof text === 'string' &&
        (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes))
      )
        throw new Error('Binary conflicts require whole-file resolution outside this text editor.')
      const currentStages = (await sandboxFile(tool, identity, path)).stages
      if (revision(bytes, currentStages) !== expected || stages !== currentStages)
        throw new Error(
          'File changed on disk. Nothing was overwritten. Reload and review the current content.'
        )
      await file.write(resolved, 0, resolved.length, 0)
      await file.truncate(resolved.length)
    } finally {
      await file.close()
    }
    await sandboxFile(tool, identity, path)
    await runGit(root, ['--literal-pathspecs', 'add', '--', path])
  })
}

export const continueRehearsal = (
  tool: string | undefined,
  identity: RehearsalIdentity,
  draftRefusal?: () => Promise<string | null>
): ReturnType<typeof rehearsalContinue> =>
  withRehearsalExecution(identity.origin_worktree, (execution) =>
    withRehearsal(identity, async () => {
      const reason = await draftRefusal?.()
      if (reason) return { kind: 'refused', message: reason }
      return rehearsalContinue(tool, identity, execution)
    })
  )
