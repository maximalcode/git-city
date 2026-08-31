import type { BranchInfo, OpResult } from '../../shared/types'
import { runGit, runGitResult } from './exec'
import { failFrom, ok, optionLikeName } from './result'
import { gitOp } from './gitOp'

const FORMAT =
  '%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(objectname:short)%09%(committerdate:unix)%09%(contents:subject)'

function parseTrack(track: string): { ahead: number; behind: number } {
  // "[ahead 1, behind 2]" | "[ahead 1]" | "[behind 2]" | "[gone]" | ""
  if (track.includes('gone')) return { ahead: 0, behind: -1 }
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return {
    ahead: ahead ? parseInt(ahead[1], 10) : 0,
    behind: behind ? parseInt(behind[1], 10) : 0
  }
}

// (named to avoid confusion with graph.ts's exported parseRefs, which parses %D decorations)
function parseForEachRef(raw: string, isRemote: boolean, current: string): BranchInfo[] {
  const out: BranchInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [name, upstream, track, hash, date, ...subject] = line.split('\t')
    // skip the symbolic origin/HEAD pointer
    if (isRemote && /\/HEAD$/.test(name)) continue
    const { ahead, behind } = parseTrack(track ?? '')
    out.push({
      name,
      current: !isRemote && name === current,
      isRemote,
      upstream: upstream || null,
      ahead,
      behind,
      lastCommitHash: hash,
      lastCommitDate: (parseInt(date, 10) || 0) * 1000,
      lastCommitSubject: subject.join('\t')
    })
  }
  return out
}

/**
 * Local branches plus remote-tracking branches that have no local counterpart.
 * A fresh clone has one local branch (the default) and every other branch as a
 * refs/remotes/origin/* ref — those must be listed so the user can check them
 * out, and so fetch has something visible to update.
 */
export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
  const [localRaw, remoteRaw, headRes] = await Promise.all([
    runGit(repoPath, ['for-each-ref', 'refs/heads', `--format=${FORMAT}`]),
    runGit(repoPath, ['for-each-ref', 'refs/remotes', `--format=${FORMAT}`]),
    runGitResult(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  ])
  const current = headRes.code === 0 ? headRes.stdout.trim() : ''

  const local = parseForEachRef(localRaw, false, current)
  const localShortNames = new Set(local.map((b) => b.name))
  const remote = parseForEachRef(remoteRaw, true, current).filter((b) => {
    // drop a remote branch whose short name already exists locally (e.g. origin/main ↔ main)
    const short = b.name.slice(b.name.indexOf('/') + 1)
    return !localShortNames.has(short)
  })

  const branches = [...local, ...remote]
  branches.sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      Number(a.isRemote) - Number(b.isRemote) ||
      b.lastCommitDate - a.lastCommitDate
  )
  return branches
}

/**
 * Switch to a branch. Handles three cases:
 * - an existing local branch → plain `git switch`
 * - a remote-tracking ref ('origin/feature') with no local branch → create a
 *   local tracking branch and switch to it
 */
export async function switchBranch(repoPath: string, name: string): Promise<OpResult> {
  const bad = optionLikeName(name)
  if (bad) return bad
  const isLocal = await runGitResult(repoPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${name}`
  ])
  if (isLocal.code === 0) {
    return gitOp(repoPath, ['switch', name])
  }

  const isRemote = await runGitResult(repoPath, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/${name}`
  ])
  if (isRemote.code === 0) {
    const short = name.slice(name.indexOf('/') + 1)
    const create = await runGitResult(repoPath, ['switch', '-c', short, '--track', name])
    if (create.code === 0) return ok()
    // a local branch of that name already exists → just switch to it
    const fallback = await runGitResult(repoPath, ['switch', short])
    return fallback.code === 0 ? ok() : failFrom(create)
  }

  return gitOp(repoPath, ['switch', name])
}

export async function createBranch(
  repoPath: string,
  name: string,
  andSwitch: boolean
): Promise<OpResult> {
  const bad = optionLikeName(name)
  if (bad) return bad
  return gitOp(repoPath, andSwitch ? ['switch', '-c', name] : ['branch', name])
}

export async function deleteBranch(
  repoPath: string,
  name: string,
  force: boolean
): Promise<OpResult> {
  const bad = optionLikeName(name)
  if (bad) return bad
  // force only ever set after the UI's explicit "not fully merged" confirmation
  return gitOp(repoPath, ['branch', force ? '-D' : '-d', name])
}
