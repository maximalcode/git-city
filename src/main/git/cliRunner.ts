import { spawn } from 'child_process'
import { CLI_TIMEOUT_MS, TIMED_OUT } from './cliFailure'
import { searchPath } from './exec'

/**
 * One shared runner for the forge CLIs.
 *
 * `runGh` and `runGlab` were the same ~44 lines spelled twice — spawn, the
 * PATH repair, a 20 s timeout with a `done` latch, ENOENT → `missing`, close
 * → `code` — differing only in the binary name and a couple of env keys. They
 * now live here once, beside `cliFailure.ts`, which already shares the
 * *classification* of what comes back because both CLIs are Go programs over
 * the same network stack (#109). A third provider is a third `CliSpec`, not a
 * third copy.
 *
 * The runner is a parameter (`CliRunner`), the way `clone.ts` injects
 * `originOf`: each adapter takes one, so tests drive the whole `HostProvider`
 * layer with a fake and never spawn `gh` or `glab` at all.
 */

/** Result of one forge CLI call — the shape both adapters already shared. */
export interface CliResult {
  code: number
  stdout: string
  stderr: string
  /** binary not found on PATH */
  missing: boolean
}

/** One call into a forge CLI. Injectable like `clone.ts`'s `originOf` (#109). */
export type CliRunner = (cwd: string, args: string[]) => Promise<CliResult>

/** env every forge CLI gets: fail fast instead of prompting, never colour. */
const SHARED_ENV = { GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' }

/** What varies between the CLIs — everything else is shared above. */
export interface CliSpec {
  binary: string
  /** extra env keys this CLI needs, on top of {@link SHARED_ENV} */
  env?: Record<string, string>
}

/**
 * Build the real runner for one CLI.
 *
 * `timeoutMs` is a parameter only so tests can use a short clock; production
 * callers take the shared 20 s default (#24).
 */
export function cliRunner(spec: CliSpec, timeoutMs: number = CLI_TIMEOUT_MS): CliRunner {
  return (cwd, args) =>
    new Promise((resolve) => {
      const child = spawn(spec.binary, args, {
        cwd,
        env: {
          ...process.env,
          // Finder-launched apps do not see Homebrew's bin — see exec.ts
          PATH: searchPath(),
          ...SHARED_ENV,
          ...spec.env
        }
      })
      let stdout = ''
      let stderr = ''
      let done = false
      const finish = (r: CliResult): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(r)
      }
      // A forge call behind a dead VPN never returns, and the panel's only
      // retry control is disabled by the very loading state that is stuck —
      // so the spinner ran forever and quitting was the exit (#24).
      const timer = setTimeout(() => {
        child.kill()
        finish({ code: -1, stdout, stderr: `${stderr}\n${TIMED_OUT}`, missing: false })
      }, timeoutMs)

      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (err) =>
        finish({
          code: -1,
          stdout,
          stderr: String(err),
          missing: (err as NodeJS.ErrnoException).code === 'ENOENT'
        })
      )
      child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr, missing: false }))
    })
}
