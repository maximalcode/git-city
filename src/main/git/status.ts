import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { isAbsolute, join, resolve } from 'path'
import type {
  FileStatus,
  RemoteInfo,
  RepoOpState,
  StatusCode,
  WorkingStatus
} from '../../shared/types'
import { runGit, runGitResult } from './exec'

/** Resolve the .git directory (may live elsewhere for worktrees); cached per repo. */
const gitDirCache = new Map<string, string>()

export async function getGitDir(repoPath: string): Promise<string> {
  const cached = gitDirCache.get(repoPath)
  if (cached) return cached
  const raw = (await runGit(repoPath, ['rev-parse', '--git-dir'])).trim()
  const dir = isAbsolute(raw) ? raw : resolve(repoPath, raw)
  gitDirCache.set(repoPath, dir)
  return dir
}

function codeOf(c: string): StatusCode {
  switch (c) {
    case 'M':
      return 'modified'
    case 'T':
      return 'typechange'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    default:
      return 'unmodified'
  }
}

/**
 * Parse `git status --porcelain=v2 -z` output. With -z, records are
 * NUL-terminated — and rename records ('2' lines) are followed by an EXTRA
 * NUL-terminated field holding the original path, so we consume tokens.
 */
export function parsePorcelainV2(raw: string): {
  files: FileStatus[]
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  headHash: string
} {
  const tokens = raw.split('\0')
  const files: FileStatus[] = []
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let hasAb = false
  let headHash = ''

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]
    if (!tok) continue
    if (tok.startsWith('# ')) {
      const [key, ...rest] = tok.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') headHash = value === '(initial)' ? '' : value
      else if (key === 'branch.head') branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') upstream = value
      else if (key === 'branch.ab') {
        hasAb = true
        const m = /\+(\d+) -(\d+)/.exec(value)
        if (m) {
          ahead = parseInt(m[1], 10)
          behind = parseInt(m[2], 10)
        }
      }
      continue
    }

    const kind = tok[0]
    if (kind === '1' || kind === '2') {
      // 1 XY sub mH mI mW hH hI path
      // 2 XY sub mH mI mW hH hI Xscore path  (next token = origPath)
      const parts = tok.split(' ')
      const xy = parts[1]
      const fixed = kind === '1' ? 8 : 9
      const path = parts.slice(fixed).join(' ')
      const file: FileStatus = {
        path,
        index: codeOf(xy[0]),
        worktree: codeOf(xy[1]),
        conflicted: false
      }
      if (kind === '2') {
        file.origPath = tokens[++t]
      }
      files.push(file)
    } else if (kind === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = tok.split(' ')
      const path = parts.slice(10).join(' ')
      files.push({ path, index: 'conflicted', worktree: 'conflicted', conflicted: true })
    } else if (kind === '?') {
      files.push({
        path: tok.slice(2),
        index: 'unmodified',
        worktree: 'untracked',
        conflicted: false
      })
    }
    // '!' (ignored) entries are never requested
  }

  // upstream configured but its ref is gone → git omits the ab header
  if (upstream && !hasAb) behind = -1
  return { files, branch, upstream, ahead, behind, headHash }
}

async function detectOpState(
  gitDir: string
): Promise<{ opState: RepoOpState; rebaseProgress?: { done: number; total: number } }> {
  if (existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply'))) {
    const dir = existsSync(join(gitDir, 'rebase-merge'))
      ? join(gitDir, 'rebase-merge')
      : join(gitDir, 'rebase-apply')
    let rebaseProgress: { done: number; total: number } | undefined
    try {
      const done = parseInt((await readFile(join(dir, 'msgnum'), 'utf8')).trim(), 10)
      const total = parseInt((await readFile(join(dir, 'end'), 'utf8')).trim(), 10)
      if (Number.isFinite(done) && Number.isFinite(total)) rebaseProgress = { done, total }
    } catch {
      // older git layouts may lack these files; the badge just goes numberless
    }
    return { opState: 'rebase', rebaseProgress }
  }
  if (existsSync(join(gitDir, 'MERGE_HEAD'))) return { opState: 'merge' }
  if (existsSync(join(gitDir, 'CHERRY_PICK_HEAD'))) return { opState: 'cherry-pick' }
  if (existsSync(join(gitDir, 'REVERT_HEAD'))) return { opState: 'revert' }
  return { opState: 'none' }
}

async function listRemotes(repoPath: string): Promise<RemoteInfo[]> {
  const res = await runGitResult(repoPath, ['remote', '-v'])
  if (res.code !== 0) return []
  const remotes = new Map<string, string>()
  for (const line of res.stdout.split('\n')) {
    const m = /^(\S+)\t(\S+) \(fetch\)$/.exec(line.trim())
    if (m) remotes.set(m[1], m[2])
  }
  return Array.from(remotes, ([name, url]) => ({ name, url }))
}

async function countStashes(repoPath: string): Promise<number> {
  const res = await runGitResult(repoPath, [
    'rev-list',
    '--walk-reflogs',
    '--count',
    'refs/stash'
  ])
  if (res.code !== 0) return 0
  const n = parseInt(res.stdout.trim(), 10)
  return Number.isFinite(n) ? n : 0
}

export async function getWorkingStatus(repoPath: string): Promise<WorkingStatus> {
  const raw = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'status',
    '--porcelain=v2',
    '-z',
    '--branch',
    '--untracked-files=all'
  ])
  const parsed = parsePorcelainV2(raw)
  const gitDir = await getGitDir(repoPath)
  const [{ opState, rebaseProgress }, remotes, stashCount] = await Promise.all([
    detectOpState(gitDir),
    listRemotes(repoPath),
    countStashes(repoPath)
  ])

  return {
    branch: parsed.branch,
    detachedAt: parsed.branch === null && parsed.headHash ? parsed.headHash.slice(0, 7) : null,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    files: parsed.files,
    opState,
    rebaseProgress,
    stashCount,
    remotes,
    headHash: parsed.headHash
  }
}
