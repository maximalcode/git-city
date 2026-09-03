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
import type { CliResult, CliRunner } from './cliRunner'
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

  let pending = false
  let applicable = false
  for (const record of records) {
    const value = statusOf(record)
    if (!value || value === 'notapplicable' || value === 'not-applicable') continue
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
        'unknown',
        'notset',
        'cancelling'
      ].includes(value)
    ) {
      pending = true
      continue
    }
    if (['approved', 'succeeded', 'success', 'passed', 'pass'].includes(value)) continue
    // Unknown Azure lifecycle/result values are unresolved, never passing.
    pending = true
  }
  if (!applicable) return 'none'
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
  const result = value.result ?? value.conclusion ?? value.evaluationResult
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

function isCiPolicy(value: unknown): boolean {
  if (!isRecord(value)) return false
  const configuration = isRecord(value.configuration) ? value.configuration : null
  const type = configuration && isRecord(configuration.type) ? configuration.type : null
  const labels = [type?.displayName, type?.name, type?.id, value.policyType, value.type]
  return labels.some(
    (label) => typeof label === 'string' && /build|status(?:[- ]check)?/i.test(label)
  )
}

function ciPolicies(value: unknown): unknown[] {
  return recordsOf(value).filter(isCiPolicy)
}

/**
 * Parse one of the two CI endpoints without turning an invalid response into
 * an empty, apparently successful check set. The provider treats an invalid
 * response as an unavailable source so the other source cannot become a
 * definitive roll-up on its own.
 */
function parseCiRecords(stdout: string, source: 'policy' | 'status'): unknown[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  const records =
    Array.isArray(parsed) ||
    (isRecord(parsed) && Array.isArray(parsed.value)) ||
    (source === 'policy' && isRecord(parsed) && Array.isArray(parsed.policyEvaluations))
      ? recordsOf(parsed)
      : null
  // A successful empty collection is a valid, available source. It means the
  // endpoint answered successfully and found no policies/statuses; only
  // malformed records should make the source unavailable.
  if (!records || records.some((record) => !isCiRecord(record, source))) return null
  return records
}

function isCiRecord(value: unknown, source: 'policy' | 'status'): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false
  const outcomes = ['status', 'state', 'result', 'conclusion', 'evaluationResult']
    .filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    .map((key) => value[key])
  // A present field is not enough: empty strings/objects/arrays are malformed
  // responses and must not make the source look available. Keep the check
  // aligned with `statusOf`, which is the mapper used for the eventual roll-up.
  if (
    outcomes.length === 0 ||
    !outcomes.every(isUsableCiOutcome) ||
    statusOf(value).length === 0
  ) {
    return false
  }
  return source !== 'policy' || isUsablePolicyMetadata(value)
}

function isUsableCiOutcome(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (!isRecord(value) || Array.isArray(value)) return false
  return statusOf(value).length > 0
}

function isUsablePolicyMetadata(value: Record<string, unknown>): boolean {
  const configuration = value.configuration
  if (configuration !== undefined && (!isRecord(configuration) || Array.isArray(configuration)))
    return false
  if (isRecord(configuration)) {
    const type = configuration.type
    if (type !== undefined && (!isRecord(type) || Array.isArray(type))) return false
  }
  const type = isRecord(configuration) ? configuration.type : undefined
  const nestedType = isRecord(type) ? type : null
  const labels = [
    nestedType?.displayName,
    nestedType?.name,
    nestedType?.id,
    value.policyType,
    value.type
  ]
  const isLabel = (label: unknown): label is string =>
    typeof label === 'string' && label.trim().length > 0
  // A single usable ID cannot make a response trustworthy when another label
  // supplied by Azure has an invalid shape. Otherwise that malformed record is
  // silently filtered out by `ciPolicies` and can leave a false green roll-up.
  return labels.some(isLabel) && labels.every((label) => label === undefined || isLabel(label))
}

function evaluationsOf(pr: RawAzurePr): unknown[] {
  return [pr.policyEvaluations, pr.policies, pr.statuses, pr.buildStatuses].flatMap(recordsOf)
}

function statusContext(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.context)) return null
  const name = value.context.name
  if (typeof name !== 'string' || name.length === 0) return null
  const genre = typeof value.context.genre === 'string' ? value.context.genre : ''
  // Azure identifies a status by the (genre, name) pair. Use a separator that
  // cannot be present in either field so `a/b` and `a` + `b` cannot collide.
  return `${genre}\u0000${name}`
}

function statusIteration(value: unknown): number | null {
  if (!isRecord(value)) return null
  const iteration = value.iterationId
  const number =
    typeof iteration === 'number'
      ? iteration
      : typeof iteration === 'string'
        ? Number(iteration)
        : NaN
  return Number.isInteger(number) && number >= 1 ? number : null
}

function statusDate(value: unknown): number {
  if (!isRecord(value)) return Number.NEGATIVE_INFINITY
  const date = value.updatedDate ?? value.creationDate
  if (typeof date !== 'string') return Number.NEGATIVE_INFINITY
  const timestamp = Date.parse(date)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

function statusId(value: unknown): number {
  if (!isRecord(value)) return Number.NEGATIVE_INFINITY
  const id =
    typeof value.id === 'number' ? value.id : typeof value.id === 'string' ? Number(value.id) : NaN
  return Number.isFinite(id) ? id : Number.NEGATIVE_INFINITY
}

/**
 * Keep the current Azure status for each check context. The status list API
 * includes statuses posted against earlier PR iterations, and `deriveCi`
 * intentionally treats any failure as authoritative. Selecting by the
 * documented iteration/context metadata first prevents an old failed run from
 * making a newer successful run appear failed.
 */
export function selectCurrentStatuses(value: unknown): unknown[] {
  const statuses = recordsOf(value)
  const current = new Map<
    string,
    { status: unknown; iteration: number; date: number; id: number; index: number }
  >()
  const unscoped: unknown[] = []
  for (const [index, status] of statuses.entries()) {
    const context = statusContext(status)
    if (context === null) {
      unscoped.push(status)
      continue
    }
    // A pull-request-level status has no iteration and is current for the PR;
    // rank it above iteration-scoped statuses when the context is the same.
    const iteration = statusIteration(status) ?? Number.POSITIVE_INFINITY
    const candidate = {
      status,
      iteration,
      date: statusDate(status),
      id: statusId(status),
      index
    }
    const previous = current.get(context)
    if (
      !previous ||
      candidate.iteration > previous.iteration ||
      (candidate.iteration === previous.iteration &&
        (candidate.date > previous.date ||
          (candidate.date === previous.date &&
            (candidate.id > previous.id ||
              (candidate.id === previous.id && candidate.index > previous.index)))))
    ) {
      current.set(context, candidate)
    }
  }
  return [
    ...unscoped,
    ...[...current.values()].sort((a, b) => a.index - b.index).map((entry) => entry.status)
  ]
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
const AZ_EXTENSION_MISSING =
  'Azure DevOps CLI extension is not installed. Install it with: az extension add --name azure-devops.'
const AZ_WORDING: CliWording = { missing: AZ_MISSING, cli: 'az', subject: 'Azure DevOps' }

const runAz: CliRunner = cliRunner({ binary: 'az', env: { AZURE_CORE_ONLY_SHOW_ERRORS: '1' } })
const PR_PAGE = 50
const CI_ENRICH_CONCURRENCY = 6

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  callback: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = next++
      if (index >= values.length) return
      results[index] = await callback(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

function missingAzureExtension(result: CliResult): boolean {
  if (result.missing) return false
  const output = result.stderr + result.stdout
  return (
    /\brepos\b.*not in the ['"]az['"] command group/i.test(output) ||
    /azure[- ]devops.*extension|extension.*azure[- ]devops/i.test(output)
  )
}

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

interface IterationChangesPage {
  files: PrFileChange[]
  nextSkip: number
  nextTop: number
}

function parseIterationChanges(stdout: string): IterationChangesPage | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!isRecord(parsed) || !Array.isArray(parsed.changeEntries)) return null
    const nextSkip = parsed.nextSkip
    const nextTop = parsed.nextTop
    return {
      files: parsePrFiles(JSON.stringify({ changeEntries: parsed.changeEntries })),
      nextSkip: typeof nextSkip === 'number' && Number.isInteger(nextSkip) ? nextSkip : 0,
      nextTop: typeof nextTop === 'number' && Number.isInteger(nextTop) ? nextTop : 0
    }
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
  const v3Ssh =
    (host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com') &&
    parts[0]?.toLowerCase() === 'v3'
  const project =
    gitIndex > 0
      ? parts[gitIndex - 1]
      : v3Ssh
        ? parts[2]
        : parts[0]
  const organization =
    host === 'dev.azure.com'
      ? parts[0]
      : v3Ssh
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
  if (/TF401019|you do not have permissions|permission(?:s)? denied/i.test(output)) {
    const host = hostnameOf(origin)
    return {
      reason: host
        ? `Azure DevOps CLI cannot access ${host} — run: az devops login and verify your repository permissions`
        : 'Azure DevOps CLI cannot access this repository — run: az devops login and verify your repository permissions',
      hint: 'login'
    }
  }
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
    if (missingAzureExtension(repo)) {
      return {
        host: 'azure',
        available: true,
        authed: false,
        isRepo: false,
        login: null,
        reason: AZ_EXTENSION_MISSING,
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
    const prs = await mapWithConcurrency(
      rawPrs.slice(0, PR_PAGE),
      CI_ENRICH_CONCURRENCY,
      (raw) => enrichCi(repoPath, mapPr(raw), route)
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
    let policyAvailable = false
    let statusAvailable = false
    // Azure exposes policy evaluations and pull-request statuses through two
    // separate, PR-scoped APIs (the CLI policy command also requires --id).
    // Keep these reads sequential inside a bounded worker: both are needed to
    // represent CI accurately, and there is no documented batch operation that
    // can replace them for a list of distinct PRs.
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
      const records = parseCiRecords(policies.stdout, 'policy')
      if (records) {
        policyAvailable = true
        evaluations.push(...ciPolicies(records))
      }
    }
    // `az repos pr status list` is not a supported Azure CLI command. Use the
    // documented Git pull-request-statuses REST resource through `invoke`.
    if (route) {
      const statuses = await run(repoPath, invokeArgs(route, 'pullRequestStatuses', pr.number))
      if (statuses.code === 0) {
        const records = parseCiRecords(statuses.stdout, 'status')
        if (records) {
          statusAvailable = true
          evaluations.push(...selectCurrentStatuses(records))
        }
      }
    }
    const ci =
      policyAvailable && statusAvailable
        ? deriveCi(evaluations)
        : policyAvailable || statusAvailable
          ? 'pending'
          : 'none'
    return { ...pr, ci }
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
    // `az repos pr list` does not consistently include policy/build status, and
    // any embedded result covers only one of the independent CI sources. Run
    // both enrichment reads so the HUD never presents partial data as final.
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
    if (iterationIds.length === 0) return { ok: true, files: [] }
    const latestIteration = Math.max(...iterationIds)
    const files = new Map<string, PrFileChange>()
    let skip = 0
    let top = 2000
    do {
      const result = await run(
        repoPath,
        invokeArgs(route, 'pullRequestIterationChanges', number, latestIteration).concat([
          '--query-parameters',
          `$top=${top}`,
          ...(skip > 0 ? [`$skip=${skip}`] : []),
          '$compareTo=0'
        ])
      )
      if (result.code !== 0) {
        return { ok: false, reason: listFailureReason(result, AZ_WORDING) }
      }
      const parsed = parseIterationChanges(result.stdout)
      if (parsed === null) {
        return { ok: false, reason: "Couldn't read changed files from Azure DevOps. Try ↻." }
      }
      for (const file of parsed.files) files.set(file.path, file)
      skip = parsed.nextSkip
      top = parsed.nextTop > 0 ? parsed.nextTop : 2000
    } while (skip > 0)
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
