import type { OpResult } from './types'

/**
 * What to say for a failure we recognise, instead of whatever git printed.
 *
 * git's own first line is written for someone reading a terminal, mid-task,
 * who already knows what they typed. In a toast with no context it is often
 * worse than nothing: a rejected push showed "To github.com:you/repo.git",
 * which reads like success, while the sentence that tells you what to do
 * ("use 'git pull' before pushing again") sat inside a collapsed expander (#26).
 *
 * Only codes with a genuinely better sentence are listed. Anything else falls
 * through to git's text, which is right for the long tail — a made-up generic
 * message would be less informative, not more.
 */
const BY_CODE: Partial<Record<NonNullable<OpResult['code']>, string>> = {
  rejected: "The remote has commits you don't have yet. Pull first, then push again.",
  auth: 'Git could not authenticate with the remote. Check your SSH key or credential helper.',
  'no-upstream': 'This branch has no upstream yet — use Publish to push it for the first time.',
  dirty: 'Commit or stash your local changes first.',
  identity:
    'Git doesn\'t know who you are yet. Run: git config --global user.name "Your Name" ' +
    'and git config --global user.email "you@example.com", then try again.'
}

/**
 * The sentence to show for a failed op.
 *
 * A message flagged `friendly` was written for this exact situation and wins
 * over the per-code wording, which is deliberately generic.
 */
export function opMessage(result: OpResult): string {
  if (result.friendly && result.message) return result.message
  const mapped = result.code ? BY_CODE[result.code] : undefined
  return mapped ?? result.message ?? 'Operation failed.'
}
