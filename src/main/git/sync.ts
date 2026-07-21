import { simpleGit, type SimpleGit } from 'simple-git'
import type { OpResult, ProgressInfo } from '../../shared/types'
import { runGit } from './exec'
import { failFromError, ok } from './result'

/**
 * Remote operations go through simple-git for its progress callback and
 * AbortSignal support. Auth stays entirely with the system git (credential
 * manager / SSH agent) — GIT_TERMINAL_PROMPT=0 turns missing credentials
 * into fast, classifiable failures instead of a hung child process.
 *
 * NOTE deliberately absent: force push. No flag, no code path.
 */

let currentOp: AbortController | null = null

/**
 * simple-git refuses remote tasks when the env carries GIT_EDITOR (unsafe-
 * editor protection) or GIT_ASKPASS (unsafe-askpass protection), and a parent
 * process may well have set either — VS Code terminals export GIT_ASKPASS, so
 * without this every remote op fails when the app is launched from one.
 * Remote ops never open an editor, and auth stays with the system git
 * (credential manager / SSH agent), so strip those keys instead of opting
 * into simple-git's unsafe mode.
 */
const UNSAFE_ENV_VARS = new Set([
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'EDITOR',
  'VISUAL',
  'GIT_ASKPASS',
  'SSH_ASKPASS'
])

function remoteEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !UNSAFE_ENV_VARS.has(k)) env[k] = v
  }
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

export function cancelCurrentOp(): void {
  currentOp?.abort()
}

function makeGit(
  repoPath: string,
  phase: 'fetching' | 'pulling' | 'pushing',
  onProgress: (p: ProgressInfo) => void,
  controller: AbortController
): SimpleGit {
  return simpleGit({
    baseDir: repoPath,
    abort: controller.signal,
    progress({ progress }) {
      onProgress({ phase, done: progress, total: 100 })
    }
  }).env(remoteEnv())
}

async function remoteOp(
  repoPath: string,
  phase: 'fetching' | 'pulling' | 'pushing',
  onProgress: (p: ProgressInfo) => void,
  fn: (git: SimpleGit) => Promise<unknown>
): Promise<OpResult> {
  const controller = new AbortController()
  currentOp = controller
  try {
    await fn(makeGit(repoPath, phase, onProgress, controller))
    return ok()
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, code: 'unknown', message: 'Operation cancelled.' }
    }
    return failFromError(err)
  } finally {
    if (currentOp === controller) currentOp = null
  }
}

export function fetchRemote(
  repoPath: string,
  onProgress: (p: ProgressInfo) => void
): Promise<OpResult> {
  return remoteOp(repoPath, 'fetching', onProgress, (git) => git.fetch(['--progress', '--prune']))
}

export function pullRemote(
  repoPath: string,
  onProgress: (p: ProgressInfo) => void
): Promise<OpResult> {
  return remoteOp(repoPath, 'pulling', onProgress, (git) => git.pull(['--progress']))
}

export async function pushRemote(
  repoPath: string,
  setUpstream: boolean,
  onProgress: (p: ProgressInfo) => void
): Promise<OpResult> {
  if (!setUpstream) {
    return remoteOp(repoPath, 'pushing', onProgress, (git) => git.push(['--progress']))
  }
  const branch = (await runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const remote = (await runGit(repoPath, ['remote'])).split('\n').map((r) => r.trim())
  const target = remote.includes('origin') ? 'origin' : (remote.find((r) => r) ?? 'origin')
  return remoteOp(repoPath, 'pushing', onProgress, (git) =>
    git.push(['--progress', '-u', target, branch])
  )
}
