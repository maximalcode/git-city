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
  if (
    /no upstream branch|no tracking information|The current branch .* has no upstream/i.test(text)
  ) {
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
  // A first commit on a machine git has never been configured on. The two
  // lines that fix it are on lines 7-8 of git's output, so they landed inside
  // a collapsed <details> almost nobody opens (#26).
  if (/Author identity unknown|empty ident name|unable to auto-detect email/i.test(text)) {
    return 'identity'
  }
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

/**
 * A failure that means git was fine but had nothing to do — an empty commit
 * message, an empty stash, a hunk that moved. The UI words these gently rather
 * than as errors, which is why they get a constructor like ok()'s instead of
 * twenty OpResult literals spelling the same shape (#113).
 */
export function nothingToDo(message: string): OpResult {
  return { ok: false, code: 'nothing-to-do', message }
}

/**
 * Guard for user-supplied names passed to git as positionals: a name starting
 * with '-' would be parsed as an option (e.g. a tag named '-d' turning a
 * create into a delete). Returns a failure OpResult, or null when fine.
 */
export function optionLikeName(name: string): OpResult | null {
  if (name.startsWith('-')) {
    return { ok: false, code: 'unknown', message: `Invalid name: ${name}` }
  }
  return null
}

/** Build a failed OpResult from a finished git process. */
export function failFrom(res: GitResult, friendly?: string): OpResult {
  const output = `${res.stderr}\n${res.stdout}`.trim()
  const code = classifyGitError(output)
  return {
    ok: false,
    code,
    message: friendly ?? firstLine(output) ?? 'git command failed',
    // a caller-supplied message was written for this exact case, so it beats
    // the generic per-code wording the UI would otherwise substitute (#26)
    friendly: friendly !== undefined,
    gitOutput: output || undefined
  }
}

export function failFromError(err: unknown): OpResult {
  const text = err instanceof Error ? err.message : String(err)
  return { ok: false, code: classifyGitError(text), message: firstLine(text), gitOutput: text }
}

/**
 * git's transport chatter, which is not an error and must never be the headline.
 *
 * A rejected push printed "To github.com:you/your-repo.git" as the whole toast —
 * which reads more like a success line than a failure, while the actual
 * "use 'git pull' before pushing again" advice sat inside a collapsed
 * expander (#26).
 */
const TRANSPORT_LINE = /^(To|From|Pushing to|Fetching|Everything up-to-date|remote:)\b/i

/**
 * Every line of git/CLI output with the severity prefix stripped and the blank
 * lines dropped. The one piece of text-massing five modules had each written
 * for themselves (#113); firstLine and its cousins are thin picks over this.
 */
export function stripNoise(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^(error|fatal|warning):\s*/i, '').trim())
    .filter((l) => l.length > 0)
}

export function firstLine(text: string): string | undefined {
  const lines = stripNoise(text)
  return lines.find((l) => !TRANSPORT_LINE.test(l)) ?? lines[0]
}
