import type { OpResult, ReflogEntry } from '../../shared/types'
import { runGit, runGitResult } from './exec'
import { failFrom, ok, optionLikeName } from './result'

const FS = '\x1f' // unit separator between fields (never appears in git output)

/**
 * Read HEAD's reflog — git's safety net. Every HEAD movement (commit, reset,
 * rebase, checkout, merge, pull…) is recorded for ~90 days, so states that
 * look "lost" (after a bad reset/rebase or a deleted branch) are still here
 * and recoverable. Read-only; throws on failure (the readOnly IPC wrapper
 * sanitizes the message).
 */
export async function getReflog(repoPath: string, limit = 100): Promise<ReflogEntry[]> {
  // %H hash · %gd selector · %gs reflog subject · %cn committer · %ct time · %s commit subject
  const fmt = ['%H', '%gd', '%gs', '%cn', '%ct', '%s'].join(FS)
  const raw = await runGit(repoPath, [
    'reflog',
    `--format=${fmt}`,
    '-n',
    String(Math.max(1, limit))
  ])

  const entries: ReflogEntry[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const [hash, selector, gs, author, at, ...rest] = line.split(FS)
    const subject = rest.join(FS)
    // reflog subject is "action: detail" (e.g. "reset: moving to HEAD~1",
    // "commit (amend): msg", "checkout: moving from a to b", "merge x: Fast-forward")
    const colon = gs.indexOf(': ')
    const action = colon === -1 ? gs : gs.slice(0, colon)
    const message = colon === -1 ? '' : gs.slice(colon + 2)
    entries.push({
      index: i,
      selector: selector || `HEAD@{${i}}`,
      hash,
      shortHash: hash.slice(0, 7),
      action,
      message,
      subject,
      author,
      date: (parseInt(at, 10) || 0) * 1000
    })
  }
  return entries
}

export type ResetMode = 'soft' | 'mixed' | 'keep' | 'hard'

/**
 * Move the current branch to a commit/ref from the reflog.
 *  - keep  (default): move branch, keep your uncommitted work — ABORTS rather
 *    than clobber local changes that would be lost. The safe "rewind".
 *  - soft:  move branch only; staged + working changes preserved.
 *  - mixed: move branch + reset the index; working tree preserved.
 *  - hard:  DESTRUCTIVE — discard everything back to the target (gated by a
 *    confirm dialog in the UI).
 * Because it only moves a LOCAL ref and never touches a remote, this stays
 * inside the no-force-push rule.
 */
export async function resetTo(repoPath: string, ref: string, mode: ResetMode): Promise<OpResult> {
  const bad = optionLikeName(ref)
  if (bad) return bad
  const res = await runGitResult(repoPath, ['reset', `--${mode}`, ref, '--'])
  if (res.code === 0) return ok()
  // Undo on a freshly cloned repository asks for HEAD@{1}, which does not
  // exist yet — git answers "log for 'HEAD' only has 1 entries", which is
  // ungrammatical, names an internal concept and has nothing to do with the
  // word "Undo" the user just clicked. Reachable seconds after a clone (#26).
  const out = `${res.stderr}\n${res.stdout}`
  if (/only has \d+ entries|unknown revision|ambiguous argument/i.test(out)) {
    return failFrom(res, 'Nothing to undo — this repository has no earlier HEAD position yet.')
  }
  return failFrom(res)
}

/**
 * Non-destructive recovery: create a new branch at a reflog point so lost work
 * reappears in the city without moving the current branch. `name` must be a
 * fresh branch name; `ref` is the hash/selector to branch from.
 */
export async function recoverToBranch(
  repoPath: string,
  name: string,
  ref: string
): Promise<OpResult> {
  const badName = optionLikeName(name)
  if (badName) return badName
  const badRef = optionLikeName(ref)
  if (badRef) return badRef
  const res = await runGitResult(repoPath, ['branch', name, ref])
  return res.code === 0 ? ok() : failFrom(res)
}
