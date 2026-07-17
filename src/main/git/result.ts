import type { OpResult } from '../../shared/types'
import type { GitResult } from './exec'

/**
 * An error whose message is written for the user and safe to show verbatim.
 * The read-only IPC boundary forwards these; everything else is replaced with
 * a generic message (raw git stderr can contain absolute paths).
 */
export class FriendlyError extends Error {}

/** Map raw git stderr/stdout onto our uniform failure codes. */
export function classifyGitError(text: string): NonNullable<OpResult['code']> {
  if (
    /terminal prompts disabled|could not read Username|Authentication failed|Permission denied \(publickey\)|access denied|HTTP 40[13]|status code: 40[13]/i.test(
      text
    )
  ) {
    return 'auth'
  }
  if (/\[rejected\]|failed to push some refs|non-fast-forward|fetch first/i.test(text)) {
    return 'rejected'
  }
  if (/no upstream branch|no tracking information|The current branch .* has no upstream/i.test(text)) {
    return 'no-upstream'
  }
  if (
    /CONFLICT|fix conflicts|Automatic merge failed|could not apply|needs merge|unmerged files|not concluded your merge|You have unmerged paths/i.test(
      text
    )
  ) {
    return 'conflict'
  }
  if (
    /would be overwritten by (checkout|merge)|Please commit your changes or stash them|cannot rebase: You have unstaged changes|cannot pull with rebase|your local changes/i.test(
      text
    )
  ) {
    return 'dirty'
  }
  if (/not fully merged/i.test(text)) return 'not-merged'
  if (
    /nothing to commit|no changes added to commit|No local changes to save|nothing added to commit|Already up to date|is up to date/i.test(
      text
    )
  ) {
    return 'nothing-to-do'
  }
  return 'unknown'
}

export function ok(message?: string): OpResult {
  return { ok: true, message }
}

/** Build a failed OpResult from a finished git process. */
export function failFrom(res: GitResult, friendly?: string): OpResult {
  const output = `${res.stderr}\n${res.stdout}`.trim()
  const code = classifyGitError(output)
  return {
    ok: false,
    code,
    message: friendly ?? firstLine(output) ?? 'git command failed',
    gitOutput: output || undefined
  }
}

export function failFromError(err: unknown): OpResult {
  const text = err instanceof Error ? err.message : String(err)
  return { ok: false, code: classifyGitError(text), message: firstLine(text), gitOutput: text }
}

function firstLine(text: string): string | undefined {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^(error|fatal|warning):\s*/i, '').trim())
    .find((l) => l.length > 0)
  return line
}
