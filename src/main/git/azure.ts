import { runGitResult } from './exec'
import type {
  HostAuth,
  OpResult,
  PrFileChange,
  PrFilesResult,
  PrListResult,
  PullRequestInfo
} from '../../shared/types'
import { classifyCliFailure, listFailureReason, opFailure, unreachable } from './cliFailure'
import type { CliWording } from './cliFailure'
import { cliRunner } from './cliRunner'
import type { CliRunner } from './cliRunner'
import type { HostProvider } from './host'
import { detectHost, hostnameOf } from './hostUrl'

/**
 * Azure DevOps policy/build evaluations use a different vocabulary from the
 * other forges. Keep the conversion pure so fixtures can exercise it without
 * an Azure account.
 */
export function deriveCi(evaluations: unknown): PullRequestInfo['ci'] {
  const records = Array.isArray(evaluations)
    ? evaluations
    : isRecord(evaluations) && Array.isArray(evaluations.value)
      ? evaluations.value
      : isRecord(evaluations) && Array.isArray(evaluations.policyEvaluations)
        ? evaluations.policyEvaluations
        : []
  if (records.length === 0) return 'none'

  let seen = false
  let pending = false
  let applicable = false
  for (const record of records) {
    const value = statusOf(record)
    if (!value || value === 'notapplicable' || value === 'not-applicable') continue
    seen = true
    applicable = true
    if (
      [
        'failed',
        'failure',
        'rejected',
        'broken',
        'error',
        'errored',
        'canceled',
        'cancelled',
        'timedout',
        'actionrequired'
      ].includes(value)
    ) {
      return 'failing'
    }
    if (
      [
        'queued',
        'running',
        'inprogress',
        'pending',
        'waiting',
        'notstarted',
        'created',
        'unknown'
      ].includes(value)
    ) {
      pending = true
    }
  }
  if (!seen || !applicable) return 'none'
  if (pending) return 'pending'
  return 'passing'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function statusOf(value: unknown): string {
  if (!isRecord(value))
    return String(value ?? '')
      .toLowerCase()
      .replace(/[ _-]/g, '')
  // Azure build records commonly say { status: 'completed', result: 'failed' }.
  // The lifecycle is not the outcome: an explicitly reported result wins so a
  // completed failed/canceled build cannot be rendered as passing.
  const result = value.result ?? value.conclusion
  if (result != null) {
    const resultValue = isRecord(result) ? statusOf(result) : String(result)
    if (resultValue) return resultValue.toLowerCase().replace(/[ _-]/g, '')
  }
  const status = value.status ?? value.state
  if (isRecord(status)) return statusOf(status)
  if (status != null) return String(status).toLowerCase().replace(/[ _-]/g, '')
  const context = value.context
  if (isRecord(context)) return statusOf(context)
  return ''
}

interface RawAzurePr {
  pullRequestId?: number | string
  number?: number | string
  id?: number | string
  title?: string
  sourceRefName?: string
  targetRefName?: string
  sourceBranch?: string
  targetBranch?: string
  source_branch?: string
  target_branch?: string
  status?: string
  state?: string
  isDraft?: boolean
  url?: string
  webUrl?: string
  _links?: { web?: { href?: string } }
  repository?: {
    webUrl?: string
    url?: string
    name?: string
    id?: string
    project?: { id?: string; name?: string }
  }
  createdBy?: { displayName?: string; uniqueName?: string; id?: string }
  author?: { displayName?: string; uniqueName?: string }
  policyEvaluations?: unknown
  policies?: unknown
  statuses?: unknown
  buildStatuses?: unknown
}

function browserPrUrl(pr: RawAzurePr): string {
  const id = prNumber(pr)
  if (!id) return ''
  const links = [pr._links?.web?.href, pr.webUrl, pr.url]
  for (const candidate of links) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      if (url.pathname.match(/\/_git\/[^/]+\/pullrequest\/\d+(?:\/|$)/i)) return url.href
    } catch {
      // Ignore malformed or REST-resource links and construct from repository below.
    }
  }
  const repositoryUrl = pr.repository?.webUrl
  if (!repositoryUrl) return ''
  try {
    const url = new URL(repositoryUrl)
    if (!url.pathname.match(/\/_git\/[^/]+\/?$/i)) return ''
    url.pathname = `${url.pathname.replace(/\/$/, '')}/pullrequest/${id}`
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return ''
  }
}

function refName(ref: unknown): string {
  return String(ref ?? '')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/tags\//, '')
}

function recordsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value)) {
    if (Array.isArray(value.value)) return value.value
    if (Array.isArray(value.policyEvaluations)) return value.policyEvaluations
    return [value]
  }
  return []
}

function evaluationsOf(pr: RawAzurePr): unknown[] {
  return [pr.policyEvaluations, pr.policies, pr.statuses, pr.buildStatuses].flatMap(recordsOf)
}

function prNumber(pr: RawAzurePr): number {
  const value = pr.pullRequestId ?? pr.number ?? pr.id
  return typeof value === 'number' ? value : Number(value) || 0
}

function hasPrNumber(pr: RawAzurePr): boolean {
  const value = pr.pullRequestId ?? pr.number ?? pr.id
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && /^\d+$/.test(value))
  )
}

/** Map one Azure DevOps pull request onto the shared PR model. */
export function mapPr(pr: RawAzurePr): PullRequestInfo {
  const evaluations = evaluationsOf(pr)
  const rawState = String(pr.status ?? pr.state ?? 'active').toUpperCase()
  return {
    number: prNumber(pr),
    title: pr.title ?? '',
    headRef: refName(pr.sourceRefName ?? pr.source_branch ?? pr.sourceBranch),
    baseRef: refName(pr.targetRefName ?? pr.target_branch ?? pr.targetBranch),
    state: rawState === 'ACTIVE' ? 'OPEN' : rawState,
    isDraft: !!pr.isDraft,
    url: browserPrUrl(pr),
    author:
      pr.createdBy?.displayName ??
      pr.createdBy?.uniqueName ??
      pr.author?.displayName ??
      pr.author?.uniqueName ??
      '',
    ci: deriveCi(evaluations)
  }
}

function parseRawPrListResponse(stdout: string): RawAzurePr[] | null {
  try {
    const parsed = JSON.parse(stdout)
    const values = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.value)
        ? parsed.value
        : null
    if (!values) return null
    return (values as RawAzurePr[]).filter(hasPrNumber)
  } catch {
    return null
  }
}

function parsePrListResponse(stdout: string): PullRequestInfo[] | null {
  const values = parseRawPrListResponse(stdout)
  return values?.map(mapPr) ?? null
}

/** Parse an Azure PR list response. Exported for fixture-driven tests. */
export function parsePrList(stdout: string): PullRequestInfo[] {
  return parsePrListResponse(stdout) ?? []
}

const AZ_MISSING =
  "Azure CLI (az) not found. If it is installed, Git City cannot see it on this app's PATH."
const AZ_WORDING: CliWording = { missing: AZ_MISSING, cli: 'az', subject: 'Azure DevOps' }

const runAz: CliRunner = cliRunner({ binary: 'az', env: { AZURE_CORE_ONLY_SHOW_ERRORS: '1' } })
const PR_PAGE = 50

function parseIterationIds(stdout: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    const values = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.value)
        ? parsed.value
        : null
    if (!values) return null
    const ids = values
      .map((value) => (isRecord(value) ? value.id : value))
      .map((value) => (typeof value === 'number' ? value : Number(value)))
      .filter((value) => Number.isInteger(value) && value > 0)
    return ids
  } catch {
    return null
  }
}

function parseIterationChanges(stdout: string): PrFileChange[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!isRecord(parsed) || !Array.isArray(parsed.changeEntries)) return null
    return parsePrFiles(JSON.stringify({ changeEntries: parsed.changeEntries }))
  } catch {
    return null
  }
}

/** The repository name can be supplied to `az repos show` when git config
 * defaults are not available (for example when this process was launched by
 * Finder). Azure's three supported remote URL shapes all end in the repo name.
 */
function repositoryName(origin: string): string | null {
  const value = origin.trim()
  if (!value) return null
  const path = value.includes('://')
    ? (() => {
        try {
          return new URL(value).pathname
        } catch {
          return ''
        }
      })()
    : value.split(':').slice(1).join(':')
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  const gitIndex = parts.findIndex((part) => part.toLowerCase() === '_git')
  const name = gitIndex >= 0 ? parts[gitIndex + 1] : parts.at(-1)
  return name ? name.replace(/\.git$/, '') : null
}

interface AzureRoute {
  organization: string
  project: string
  repositoryId: string
}

/** Extract the REST route components from Azure's HTTPS and SSH remotes. */
function routeFromOrigin(origin: string): AzureRoute | null {
  const value = origin.trim()
  const host = hostnameOf(value)
  const repositoryId = repositoryName(value)
  if (!host || !repositoryId) return null

  const path = value.includes('://')
    ? (() => {
        try {
          return new URL(value).pathname
        } catch {
          return ''
        }
      })()
    : value.split(':').slice(1).join(':')
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  const gitIndex = parts.findIndex((part) => part.toLowerCase() === '_git')
  const project =
    gitIndex > 0
      ? parts[gitIndex - 1]
      : host === 'ssh.dev.azure.com' && parts[0]?.toLowerCase() === 'v3'
        ? parts[2]
        : parts[0]
  const organization =
    host === 'dev.azure.com'
      ? parts[0]
      : host === 'ssh.dev.azure.com'
        ? parts[1]
        : host.endsWith('.visualstudio.com')
          ? host.slice(0, -'.visualstudio.com'.length)
          : null
  return organization && project ? { organization, project, repositoryId } : null
}

function routeFromMetadata(metadata: RawAzurePr, origin: string): AzureRoute | null {
  const fromOrigin = routeFromOrigin(origin)
  const fromRepository = routeFromOrigin(metadata.repository?.webUrl ?? '')
  const repositoryId =
    metadata.repository?.id ?? fromRepository?.repositoryId ?? fromOrigin?.repositoryId
  const project =
    metadata.repository?.project?.id ??
    metadata.repository?.project?.name ??
    fromRepository?.project ??
    fromOrigin?.project
  const organization = fromOrigin?.organization ?? fromRepository?.organization
  return organization && project && repositoryId ? { organization, project, repositoryId } : null
}

function invokeArgs(
  route: AzureRoute,
  resource: string,
  pullRequestId: number,
  iterationId?: number
): string[] {
  const args = [
    'devops',
    'invoke',
    '--area',
    'git',
    '--resource',
    resource,
    '--route-parameters',
    `project=${route.project}`,
    `repositoryId=${route.repositoryId}`,
    `pullRequestId=${pullRequestId}`
  ]
  if (iterationId !== undefined) args.push(`iterationId=${iterationId}`)
  args.push(
    '--organization',
    `https://dev.azure.com/${route.organization}`,
    '--detect',
    'true',
    '--api-version',
    '7.1',
    '--output',
    'json'
  )
  return args
}

async function originFor(repoPath: string): Promise<string> {
  try {
    return (await runGitResult(repoPath, ['remote', 'get-url', 'origin'])).stdout.trim()
  } catch {
    // The provider can still report a useful Azure response when the caller's
    // test fixture or a transiently unavailable checkout has no git remote.
    return ''
  }
}

async function currentBranch(repoPath: string): Promise<string> {
  const result = await runGitResult(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return result.code === 0 ? result.stdout.trim() : ''
}

function azureRepoProbeFailure(
  result: Awaited<ReturnType<CliRunner>>,
  origin: string
): { reason: string; hint: HostAuth['hint'] } {
  const output = result.stderr + result.stdout
  const failure = classifyCliFailure(output)
  if (failure !== 'other') return unreachable('Azure DevOps', failure)
  if (
    /az (?:devops )?login|not logged in|unauthorized|authentication|TF400813|\b401\b/i.test(output)
  ) {
    const host = hostnameOf(origin)
    return {
      reason: host
        ? `Azure DevOps CLI is not authenticated for ${host} — run: az devops login`
        : 'Azure DevOps CLI is not authenticated — run: az devops login',
      hint: 'login'
    }
  }
  if (/404|not found|does not exist|no repository|could not detect/i.test(output)) {
    return { reason: 'This repository has no Azure DevOps remote.', hint: 'none' }
  }
  return {
    reason: output.trim()
      ? `az could not read this repository (${output.trim().split('\n')[0]})`
      : 'az could not read this repository.',
    hint: 'retry'
  }
}

/** Build the Azure provider over an injectable CLI runner. */
export function createAzureProvider(run: CliRunner): HostProvider {
  async function status(repoPath: string, origin = ''): Promise<HostAuth> {
    const actualOrigin =
      origin || (await runGitResult(repoPath, ['remote', 'get-url', 'origin'])).stdout.trim()
    if (detectHost(actualOrigin) !== 'azure') {
      return {
        host: 'azure',
        available: true,
        authed: false,
        isRepo: false,
        login: null,
        reason: 'This repository has no Azure DevOps remote.',
        hint: 'none'
      }
    }

    const repository = repositoryName(actualOrigin)
    const repoArgs = repository
      ? ['repos', 'show', '--repository', repository, '--detect', 'true', '--output', 'json']
      : [
          'repos',
          'pr',
          'list',
          '--status',
          'active',
          '--top',
          '1',
          '--detect',
          'true',
          '--output',
          'json'
        ]
    const repo = await run(repoPath, repoArgs)
    if (repo.missing) {
      return {
        host: 'azure',
        available: false,
        authed: false,
        isRepo: false,
        login: null,
        reason: AZ_MISSING,
        hint: 'install'
      }
    }
    if (repo.code !== 0) {
      const failure = azureRepoProbeFailure(repo, actualOrigin)
      return {
        host: 'azure',
        available: true,
        // A repository miss, offline response, or server error does not mean
        // the DevOps credential is invalid. Only an explicit auth failure
        // should make the panel call the user logged out.
        authed: failure.hint !== 'login',
        isRepo: false,
        login: null,
        ...failure
      }
    }
    return {
      host: 'azure',
      available: true,
      authed: true,
      isRepo: true,
      login: null,
      reason: null
    }
  }

  async function listPullRequests(repoPath: string): Promise<PrListResult> {
    const result = await run(repoPath, [
      'repos',
      'pr',
      'list',
      '--status',
      'active',
      '--top',
      String(PR_PAGE + 1),
      '--include-links',
      '--detect',
      'true',
      '--output',
      'json'
    ])
    if (result.code !== 0) return { ok: false, reason: listFailureReason(result, AZ_WORDING) }
    const rawPrs = parseRawPrListResponse(result.stdout)
    if (!rawPrs) {
      return { ok: false, reason: "Couldn't read the response from az. Try ↻." }
    }
    const route = await routeForList(repoPath, rawPrs[0])
    const prs = await Promise.all(
      rawPrs.slice(0, PR_PAGE).map((raw) => enrichCi(repoPath, mapPr(raw), route))
    )
    return { ok: true, prs, more: rawPrs.length > PR_PAGE }
  }

  async function routeForList(repoPath: string, firstPr?: RawAzurePr): Promise<AzureRoute | null> {
    const origin = await originFor(repoPath)
    return routeFromOrigin(origin) ?? (firstPr ? routeFromMetadata(firstPr, origin) : null)
  }

  async function enrichCi(
    repoPath: string,
    pr: PullRequestInfo,
    route: AzureRoute | null
  ): Promise<PullRequestInfo> {
    const evaluations: unknown[] = []
    const policies = await run(repoPath, [
      'repos',
      'pr',
      'policy',
      'list',
      '--id',
      String(pr.number),
      '--detect',
      'true',
      '--output',
      'json'
    ])
    if (policies.code === 0) {
      try {
        evaluations.push(...recordsOf(JSON.parse(policies.stdout)))
      } catch {
        // An unavailable or malformed policy response is represented as
        // `none`; it must not make the whole open-PR list disappear.
      }
    }
    // `az repos pr status list` is not a supported Azure CLI command. Use the
    // documented Git pull-request-statuses REST resource through `invoke`.
    if (route) {
      const statuses = await run(repoPath, invokeArgs(route, 'pullRequestStatuses', pr.number))
      if (statuses.code === 0) {
        try {
          evaluations.push(...recordsOf(JSON.parse(statuses.stdout)))
        } catch {
          // An unavailable or malformed status is represented as `none`.
        }
      }
    }
    return { ...pr, ci: deriveCi(evaluations) }
  }

  async function currentBranchPr(repoPath: string): Promise<PullRequestInfo | null> {
    const branch = await currentBranch(repoPath)
    if (!branch || branch === 'HEAD') return null
    const result = await run(repoPath, [
      'repos',
      'pr',
      'list',
      '--status',
      'active',
      '--source-branch',
      branch,
      '--top',
      '2',
      '--include-links',
      '--detect',
      'true',
      '--output',
      'json'
    ])
    if (result.code !== 0) return null
    const [pr] = parsePrList(result.stdout)
    if (!pr) return null
    // `az repos pr list` does not consistently include policy/build status.
    // One policy read for the branch PR keeps the HUD useful without making a
    // request per item in the open-PR list.
    if (pr.ci !== 'none') return pr
    const route = await routeForList(repoPath)
    return enrichCi(repoPath, pr, route)
  }

  async function pullRequestFiles(repoPath: string, number: number): Promise<PrFilesResult> {
    // `az repos pr show` is metadata only. Its repository/project identifiers
    // are needed to address the iteration-changes REST resource below, but its
    // response must never be interpreted as a file list.
    const metadata = await run(repoPath, [
      'repos',
      'pr',
      'show',
      '--id',
      String(number),
      '--detect',
      'true',
      '--output',
      'json'
    ])
    if (metadata.code !== 0) {
      return { ok: false, reason: listFailureReason(metadata, AZ_WORDING) }
    }
    const origin = await originFor(repoPath)
    let route: AzureRoute | null = null
    try {
      const parsed = JSON.parse(metadata.stdout) as RawAzurePr
      route = routeFromMetadata(parsed, origin)
    } catch {
      // Report the unavailable result below rather than pretending there are no files.
    }
    if (!route) {
      return { ok: false, reason: "Couldn't read changed files from Azure DevOps. Try ↻." }
    }
    const iterations = await run(repoPath, invokeArgs(route, 'pullRequestIterations', number))
    if (iterations.code !== 0) {
      return { ok: false, reason: listFailureReason(iterations, AZ_WORDING) }
    }
    const iterationIds = parseIterationIds(iterations.stdout)
    if (iterationIds === null) {
      return { ok: false, reason: "Couldn't read changed files from Azure DevOps. Try ↻." }
    }
    const files = new Map<string, PrFileChange>()
    for (const iterationId of iterationIds) {
      const result = await run(
        repoPath,
        invokeArgs(route, 'pullRequestIterationChanges', number, iterationId).concat([
          '--query-parameters',
          '$top=2000'
        ])
      )
      if (result.code !== 0) {
        return { ok: false, reason: listFailureReason(result, AZ_WORDING) }
      }
      const parsed = parseIterationChanges(result.stdout)
      if (parsed === null) {
        return { ok: false, reason: "Couldn't read changed files from Azure DevOps. Try ↻." }
      }
      for (const file of parsed) files.set(file.path, file)
    }
    return { ok: true, files: [...files.values()] }
  }

  async function checkoutPr(repoPath: string, number: number): Promise<OpResult> {
    const result = await run(repoPath, ['repos', 'pr', 'checkout', '--id', String(number)])
    return result.code === 0
      ? { ok: true }
      : opFailure(result, AZ_MISSING, 'Could not check out the pull request.')
  }

  async function createPr(
    repoPath: string,
    base: string,
    title: string,
    body: string
  ): Promise<OpResult> {
    const args = [
      'repos',
      'pr',
      'create',
      '--title',
      title,
      '--description',
      body,
      '--detect',
      'true'
    ]
    if (base) args.push('--target-branch', base)
    const result = await run(repoPath, args)
    return result.code === 0
      ? { ok: true }
      : opFailure(result, AZ_MISSING, 'Could not create the pull request.')
  }

  return {
    kind: 'azure',
    status,
    listPullRequests,
    currentBranchPr,
    pullRequestFiles,
    checkoutPr,
    createPr
  }
}

export const azureProvider: HostProvider = createAzureProvider(runAz)

interface RawAzureFile {
  path?: string
  item?: { path?: string }
  additions?: number
  deletions?: number
}

export function parsePrFiles(stdout: string): PrFileChange[] {
  try {
    const parsed = JSON.parse(stdout) as
      | RawAzureFile[]
      | { files?: RawAzureFile[]; changes?: RawAzureFile[]; changeEntries?: RawAzureFile[] }
    const files = Array.isArray(parsed)
      ? parsed
      : (parsed.files ?? parsed.changes ?? parsed.changeEntries ?? [])
    return (Array.isArray(files) ? files : [])
      .map((file) => ({
        // Azure REST paths are rooted at `/`; the shared model is Git-relative
        // like the GitHub and GitLab adapters.
        path: (file.path ?? file.item?.path ?? '').replace(/^\/+/, ''),
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0
      }))
      .filter((file) => file.path.length > 0)
  } catch {
    return []
  }
}
