import { spawn } from 'child_process'
import { createInterface } from 'readline'
import { FriendlyError } from './result'

/**
 * Shared git process runners. Every git child process gets:
 * - GIT_TERMINAL_PROMPT=0  → missing credentials fail fast instead of hanging
 *   (the GUI has no terminal to answer a prompt anyway)
 * - GIT_EDITOR=true        → merge/rebase/cherry-pick --continue never open an editor
 */
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true'
}

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Every git call goes through a spawn, so a machine without git on PATH fails
 * with a bare `spawn git ENOENT` — which reaches the user as either a generic
 * "could not load" or that raw string, neither of which says what to do. The
 * packaged app is the case that matters: installing the .exe or .dmg does not
 * install git.
 */
export function gitMissingError(err: unknown): FriendlyError | null {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
    ? new FriendlyError(
        'Git is not installed, or not on your PATH. Install it from git-scm.com, then restart Git City.'
      )
    : null
}

/** Run git and always resolve with the exit code + streams; never throws on nonzero exit. */
export function runGitResult(
  cwd: string,
  args: string[],
  opts?: { signal?: AbortSignal; env?: Record<string, string>; input?: string }
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const stdin: 'pipe' | 'ignore' = opts?.input !== undefined ? 'pipe' : 'ignore'
    const child = spawn('git', args, {
      cwd,
      stdio: [stdin, 'pipe', 'pipe'],
      env: opts?.env ? { ...GIT_ENV, ...opts.env } : GIT_ENV,
      signal: opts?.signal
    })
    let stdout = ''
    let stderr = ''
    if (opts?.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {}) // ignore EPIPE if git rejects before reading
      child.stdin.write(opts.input)
      child.stdin.end()
    }
    child.stdout!.on('data', (d) => (stdout += d))
    child.stderr!.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      // AbortSignal fires 'error' with ABORT_ERR; surface as a normal failed result
      if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
        resolve({ code: -1, stdout, stderr: stderr || 'Operation cancelled.' })
      } else {
        reject(gitMissingError(err) ?? err)
      }
    })
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** Run git and return stdout; throws with git's stderr on failure. */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  const res = await runGitResult(cwd, args)
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || `git ${args.join(' ')} exited with ${res.code}`)
  }
  return res.stdout
}

/**
 * Run git and return raw stdout bytes (never string-decoded) — for binary
 * content like image blobs. Resolves null on a nonzero exit (e.g. the path
 * doesn't exist at that ref) instead of throwing. Caps output to avoid loading
 * a huge binary into memory.
 */
export function runGitBuffer(
  cwd: string,
  args: string[],
  maxBytes = 12 * 1024 * 1024
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV })
    const chunks: Buffer[] = []
    let total = 0
    let over = false
    child.stdout.on('data', (d: Buffer) => {
      total += d.length
      if (total > maxBytes) {
        over = true
        child.kill()
        return
      }
      chunks.push(d)
    })
    child.stderr.on('data', () => {}) // discard; a failure just means "no blob"
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (over || code !== 0) resolve(null)
      else resolve(Buffer.concat(chunks))
    })
  })
}

/** Stream git stdout line by line (for large outputs like `git log`). */
export function runGitLines(
  cwd: string,
  args: string[],
  onLine: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV })
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity })
    rl.on('line', onLine)
    child.on('error', (e) => reject(gitMissingError(e) ?? e))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.trim() || `git ${args.join(' ')} exited with ${code}`))
    })
  })
}
