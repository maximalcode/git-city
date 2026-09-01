import { runGitResult } from './exec'
import type {
  HostAuth,
  OpResult,
  PrFilesResult,
  PrListResult,
  PullRequestInfo
} from '../../shared/types'
import { githubProvider } from './github'
import { gitlabProvider } from './gitlab'
import type { HostKind } from './hostKind'
import { detectHost, hostnameOf } from './hostUrl'

/**
 * Which forge a repository lives on, and the one interface both of them satisfy.
 *
 * GitHub and GitLab are reached the same way: through the vendor's own CLI (`gh`
 * / `glab`), so the app never holds a token. The renderer only ever sees the
 * GitHub vocabulary — a GitLab merge request is mapped onto `PullRequestInfo`
 * and only the panel's wording changes.
 */

export type { HostKind } from './hostKind'
export { detectHost, hostnameOf } from './hostUrl'

export interface HostProvider {
  kind: Exclude<HostKind, 'unknown'>
  /** `origin` lets a provider name the host in its auth message. */
  status(repoPath: string, origin?: string): Promise<HostAuth>
  listPullRequests(repoPath: string): Promise<PrListResult>
  currentBranchPr(repoPath: string): Promise<PullRequestInfo | null>
  pullRequestFiles(repoPath: string, number: number): Promise<PrFilesResult>
  checkoutPr(repoPath: string, number: number): Promise<OpResult>
  createPr(repoPath: string, base: string, title: string, body: string): Promise<OpResult>
}

/**
 * How long an origin URL is reused before git is asked again.
 *
 * One panel refresh calls {@link probeHost} three times — status, list, and
 * the current branch's PR — and each would otherwise spawn its own
 * `git remote get-url`. A short window collapses that burst into a single spawn
 * while still re-reading the remote on the next refresh, so re-pointing origin
 * is picked up rather than cached for the life of the process.
 */
const ORIGIN_TTL_MS = 5_000
const originCache = new Map<string, { url: string; at: number }>()

async function originUrlOf(repoPath: string): Promise<string> {
  const hit = originCache.get(repoPath)
  const now = Date.now()
  if (hit && now - hit.at < ORIGIN_TTL_MS) return hit.url
  const res = await runGitResult(repoPath, ['remote', 'get-url', 'origin'])
  const url = res.code === 0 ? res.stdout.trim() : ''
  originCache.set(repoPath, { url, at: now })
  return url
}

const PROVIDERS: Record<Exclude<HostKind, 'unknown'>, HostProvider> = {
  github: githubProvider,
  gitlab: gitlabProvider
}

/**
 * What a probe learned. `auth` is set only when nobody claimed the repository:
 * it carries the most informative thing we heard, so the panel can say "glab
 * is not installed" instead of inventing a verdict out of the silence of a CLI
 * that was never there (#24).
 */
export interface HostProbe {
  provider: HostProvider | null
  auth: HostAuth | null
}

/**
 * How long a *negative* probe is remembered.
 *
 * It used to be cached for the life of the process, which broke the app's own
 * instructions: the user was told to install the CLI, installed it, pressed ↻ —
 * and got the identical message back, because every refresh returned the cached
 * null. Only relaunching cleared it (#24).
 *
 * A positive result is still cached indefinitely; a provider that claimed the
 * repository does not stop having claimed it.
 */
const NEGATIVE_TTL_MS = 5_000
const probed = new Map<string, { probe: HostProbe; at: number }>()

/**
 * The provider for a repository, plus whatever we learned when there isn't one.
 *
 * Hostname detection covers github.com / gitlab.com and any instance that keeps
 * the vendor name in its domain. For a self-hosted instance on a custom domain
 * we ask each CLI whether it recognises the repo — that is the only honest way
 * to tell `git.acme.com` apart, and it costs one cheap call that only runs when
 * the URL was inconclusive.
 *
 * `candidates` is injected so tests can drive the probe with fake-runner
 * providers — the seam the adapters expose since their runners were lifted
 * (#109). Production callers take the two real ones.
 */
export async function probeHost(
  repoPath: string,
  candidates: HostProvider[] = [gitlabProvider, githubProvider]
): Promise<HostProbe> {
  const origin = await originUrlOf(repoPath)
  const kind = detectHost(origin)
  if (kind !== 'unknown') return { provider: PROVIDERS[kind], auth: null }

  const key = `${repoPath}\0${origin}`
  const hit = probed.get(key)
  if (hit && (hit.probe.provider !== null || Date.now() - hit.at < NEGATIVE_TTL_MS)) {
    return hit.probe
  }

  const attempts: HostAuth[] = []
  let provider: HostProvider | null = null
  for (const candidate of candidates) {
    const auth = await candidate.status(repoPath, origin)
    attempts.push(auth)
    if (auth.isRepo) {
      provider = candidate
      break
    }
  }

  const probe: HostProbe = { provider, auth: provider ? null : bestAttempt(attempts, origin) }
  probed.set(key, { probe, at: Date.now() })
  return probe
}

/** Just the provider, for callers that don't care why there isn't one. */
export async function providerFor(
  repoPath: string,
  candidates: HostProvider[] = [gitlabProvider, githubProvider]
): Promise<HostProvider | null> {
  return (await probeHost(repoPath, candidates)).provider
}

/**
 * The most useful thing the probe learned when nobody claimed the repository.
 *
 * "Neither CLI is installed" is a fact the old code had in hand and discarded:
 * it resolved an unknown host to the GitHub vocabulary, told a self-hosted
 * GitLab user their repository has no GitLab remote — false — and pointed them
 * at `gh`, the wrong tool (#24). A missing CLI is an answer; silence is not.
 */
export function bestAttempt(attempts: HostAuth[], origin: string): HostAuth {
  if (attempts.length > 0 && attempts.every((a) => !a.available)) {
    const where = hostnameOf(origin) ?? 'this remote'
    return {
      host: 'unknown',
      available: false,
      authed: false,
      isRepo: false,
      login: null,
      reason:
        `Neither gh nor glab is installed, so Git City can't tell which forge ${where} is. ` +
        'Install gh (cli.github.com) or glab (gitlab.com/gitlab-org/cli).',
      hint: 'install'
    }
  }
  // A CLI that was present and could not answer (offline, timed out, logged
  // out) knows more than one that simply said "not mine" — keep its reason.
  const informative = attempts.find(
    (a) => a.available && (a.hint === 'retry' || a.hint === 'login')
  )
  if (informative) return informative
  const missing = attempts.find((a) => !a.available)
  if (missing) return missing
  return unknownHostAuth()
}

/** The state shown when both CLIs were present, authenticated, and said no. */
export function unknownHostAuth(): HostAuth {
  return {
    host: 'unknown',
    available: false,
    authed: false,
    isRepo: false,
    login: null,
    reason: 'This repository has no GitHub or GitLab remote.',
    hint: 'none'
  }
}
