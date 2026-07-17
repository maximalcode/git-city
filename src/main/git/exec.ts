import { spawn } from 'child_process'
import { createInterface } from 'readline'

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

/** Run git and always resolve with the exit code + streams; never throws on nonzero exit. */
export function runGitResult(
  cwd: string,
  args: string[],
  opts?: { signal?: AbortSignal; env?: Record<string, string> }
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts?.env ? { ...GIT_ENV, ...opts.env } : GIT_ENV,
      signal: opts?.signal
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      // AbortSignal fires 'error' with ABORT_ERR; surface as a normal failed result
      if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
        resolve({ code: -1, stdout, stderr: stderr || 'Operation cancelled.' })
      } else {
        reject(err)
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
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.trim() || `git ${args.join(' ')} exited with ${code}`))
    })
  })
}
