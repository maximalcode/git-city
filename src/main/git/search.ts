import type {
  CommitDetail,
  CommitFileChange,
  CommitHit,
  CommitSearchResult,
  CommitSearchScope,
  GrepHit,
  GrepResult
} from '../../shared/types'
import { runGit, runGitResult } from './exec'

const DEFAULT_LIMIT = 40
const TAB = '\t'
const US = '\x1f' // unit separator for commit-detail fields

// ---------- pure parsers (unit-tested) ----------

/** Parse `git log --format=%H\t%an\t%at\t%s` output into commit hits. */
export function parseCommitLog(raw: string): CommitHit[] {
  const out: CommitHit[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [hash, author, at, ...rest] = line.split(TAB)
    if (!hash) continue
    out.push({
      hash,
      shortHash: hash.slice(0, 7),
      author: author ?? '',
      date: (parseInt(at, 10) || 0) * 1000,
      subject: rest.join(TAB)
    })
  }
  return out
}

const HASH_RE = /^[0-9a-f]{7,40}$/i

/** Heuristic: does the query look like a commit-hash prefix? */
export function looksLikeHash(q: string): boolean {
  return HASH_RE.test(q.trim())
}

/** Parse `git grep -n` output (`path:line:text`); tolerates colons in paths. */
export function parseGrep(raw: string): GrepHit[] {
  const out: GrepHit[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    // non-greedy path so a colon in the filename doesn't swallow the line number
    const m = /^(.+?):(\d+):(.*)$/.exec(line)
    if (!m) continue
    out.push({ path: m[1], line: parseInt(m[2], 10), text: m[3] })
  }
  return out
}

/** Map git's `%G?` signature code to a coarse verification state. */
export function mapSignature(code: string): CommitDetail['verification'] {
  if (code === 'G' || code === 'U') return 'good' // good (U = good, unknown validity)
  if (code === 'B') return 'bad'
  if (code === 'N' || code === '') return 'none'
  return 'unknown' // X/Y/R/E — expired/revoked/error
}

/** Parse `git show --numstat --format=` output into per-file change counts. */
export function parseNumstat(raw: string): CommitFileChange[] {
  const out: CommitFileChange[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [add, del, ...rest] = line.split(TAB)
    if (rest.length === 0) continue
    const binary = add === '-' || del === '-'
    out.push({
      path: rest.join(TAB),
      additions: binary ? -1 : parseInt(add, 10) || 0,
      deletions: binary ? -1 : parseInt(del, 10) || 0,
      binary
    })
  }
  return out
}

// ---------- git-backed queries ----------

const LOG_FORMAT = `--format=%H${TAB}%an${TAB}%at${TAB}%s`

/**
 * Search commits across all refs. `auto` resolves a hash-looking query as a
 * direct lookup (falling back to a message search), otherwise it searches
 * commit messages. `content` uses git's pickaxe (`-S`) to find commits that
 * added or removed the string.
 */
export async function searchCommits(
  repoPath: string,
  query: string,
  scope: CommitSearchScope = 'auto',
  limit = DEFAULT_LIMIT
): Promise<CommitSearchResult> {
  const q = query.trim()
  if (!q) return { hits: [], truncated: false }

  const eff: CommitSearchScope = scope === 'auto' ? (looksLikeHash(q) ? 'hash' : 'message') : scope

  if (eff === 'hash') {
    const res = await runGitResult(repoPath, [
      '-c',
      'core.quotepath=false',
      'show',
      '--no-patch',
      LOG_FORMAT,
      q
    ])
    if (res.code === 0) {
      const hits = parseCommitLog(res.stdout)
      if (hits.length) return { hits, truncated: false }
    }
    // not a resolvable hash → fall through to a message search on the same text
  }

  const args = [
    '-c',
    'core.quotepath=false',
    'log',
    '--all',
    '--no-color',
    LOG_FORMAT,
    '-n',
    String(limit + 1)
  ]
  if (eff === 'author') args.push('-i', `--author=${q}`)
  else if (eff === 'content') args.push(`-S${q}`)
  else args.push('-i', `--grep=${q}`) // message + hash-fallback

  const res = await runGitResult(repoPath, args)
  if (res.code !== 0) return { hits: [], truncated: false }
  const all = parseCommitLog(res.stdout)
  return { hits: all.slice(0, limit), truncated: all.length > limit }
}

/** Search tracked working-tree contents with `git grep` (fixed-string, case-insensitive). */
export async function grepWorkingTree(
  repoPath: string,
  query: string,
  limit = DEFAULT_LIMIT
): Promise<GrepResult> {
  const q = query.trim()
  if (!q) return { hits: [], truncated: false }
  // note: git grep has no per-file cap flag (`--max-count` is a `grep`-ism it
  // rejects), so we cap the total set after parsing instead.
  const res = await runGitResult(repoPath, [
    '-c',
    'core.quotepath=false',
    'grep',
    '-n', // line numbers
    '-I', // skip binary files
    '-F', // fixed string, not regex
    '-i', // case-insensitive
    '-e',
    q
  ])
  // git grep exits 1 when there are simply no matches — that's not an error
  if (res.code !== 0 && res.code !== 1) return { hits: [], truncated: false }
  const all = parseGrep(res.stdout)
  return { hits: all.slice(0, limit), truncated: all.length > limit }
}

/** Full detail for one commit: header, signature state and changed files. */
export async function commitDetail(repoPath: string, hash: string): Promise<CommitDetail> {
  const head = await runGit(repoPath, [
    '-c',
    'core.quotepath=false',
    'show',
    '--no-patch',
    `--format=%H${US}%an${US}%ae${US}%at${US}%G?${US}%s${US}%b`,
    hash
  ])
  const [h, author, email, at, gsig, subject, ...bodyParts] = head.split(US)
  const body = bodyParts.join(US).replace(/\n+$/, '')

  const numstat = await runGitResult(repoPath, [
    '-c',
    'core.quotepath=false',
    'show',
    '--numstat',
    '--format=',
    '--no-renames',
    hash
  ])
  const files = numstat.code === 0 ? parseNumstat(numstat.stdout) : []

  return {
    hash: h,
    shortHash: (h ?? '').slice(0, 7),
    author: author ?? '',
    email: email ?? '',
    date: (parseInt(at, 10) || 0) * 1000,
    subject: subject ?? '',
    body,
    verification: mapSignature(gsig ?? ''),
    files
  }
}
