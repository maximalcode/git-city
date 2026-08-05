/**
 * What to say when opening a repository fails.
 *
 * All of these used to collapse into one sentence — "The selected folder is not
 * a git repository." — for a folder that unambiguously was one. A bare clone, a
 * `.git` directory picked by mistake, a folder the process cannot read, and
 * git's own dubious-ownership refusal all landed there, so the user re-picked
 * the same folder and concluded the repository was broken (#25).
 *
 * Pure and tested: these strings are the entire user-visible product of the
 * failure, and the only thing worth asserting about them is that they name a
 * cause and an action.
 */

export const BARE_REPOSITORY =
  'That is a bare repository — it has no working tree to render. Clone it first ' +
  '(git clone <path> <dest>) and open the clone.'

export const INSIDE_GIT_DIR =
  "That's the .git folder itself. Open the folder that contains it instead."

export const NOT_A_REPOSITORY = 'The selected folder is not a git repository.'

/**
 * Cleaned-up git stderr, or null when there is nothing worth showing.
 *
 * Dubious ownership is kept whole rather than reduced to its first line: git's
 * first line states the problem, and the `git config --global --add
 * safe.directory …` line underneath it is the entire fix. Throwing that away
 * was the worst version of this failure — the app had the exact command the
 * user needed to type and dropped it.
 */
export function gitComplaint(stderr: string): string | null {
  const text = stderr.trim()
  if (!text) return null

  if (/dubious ownership/i.test(text)) {
    return text
      .split('\n')
      .map((l) => l.replace(/^(fatal|error|warning):\s*/i, '').trim())
      .filter((l) => l.length > 0)
      .join('\n')
  }

  const first = text
    .split('\n')
    .map((l) => l.replace(/^(fatal|error|warning):\s*/i, '').trim())
    .find((l) => l.length > 0)
  return first ?? null
}

/** A folder git can see but the process cannot read. */
export function permissionMessage(cwd: string): string {
  return (
    `Git City does not have permission to read ${cwd}. ` +
    `Check the folder's permissions and ownership, or open it from a different location.`
  )
}

/**
 * A history pass that died part-way. The repository is untouched — analysis is
 * read-only — and saying so is the whole point: the previous message was raw
 * git stderr, or the internal command line plus "exited with null", either of
 * which reads like the app broke something.
 */
export function analysisFailedMessage(repoName: string): string {
  return (
    `Reading the history of ${repoName} stopped part-way through. ` +
    `Nothing in your repository was changed — try opening it again.`
  )
}
