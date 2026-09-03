import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import {
  createAzureProvider,
  deriveCi,
  mapPr,
  parsePrFiles,
  parsePrList,
  selectCurrentStatuses
} from './azure'
import type { CliResult, CliRunner } from './cliRunner'
import { makeTempRepo } from './fixtures'

const ok = (stdout = ''): CliResult => ({ code: 0, stdout, stderr: '', missing: false })
const err = (stderr: string): CliResult => ({ code: 1, stdout: '', stderr, missing: false })
const azureCiFixture = (name: string): CliResult =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/azure-ci/${name}.json`, import.meta.url), 'utf8')
  ) as CliResult

function listFixturePr(): string {
  return JSON.stringify([{ pullRequestId: 136, title: 'Partial CI', status: 'active' }])
}

async function listWithCiFixtures(
  policy: CliResult,
  status: CliResult
): Promise<Awaited<ReturnType<ReturnType<typeof createAzureProvider>['listPullRequests']>>> {
  const repo = makeTempRepo('git-city-azure-')
  repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
  const run: CliRunner = async (_cwd, args) => {
    if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'list') return ok(listFixturePr())
    if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'policy') return policy
    if (args[0] === 'devops' && args.includes('pullRequestStatuses')) return status
    return ok('[]')
  }
  return createAzureProvider(run).listPullRequests(repo.path)
}

describe('Azure DevOps response mapping', () => {
  it('maps the CLI fixture into PullRequestInfo', () => {
    expect(
      mapPr({
        pullRequestId: 42,
        title: 'Ship the skyline',
        sourceRefName: 'refs/heads/feature/skyline',
        targetRefName: 'refs/heads/develop',
        status: 'active',
        isDraft: true,
        // The API's web link is a REST resource in this response. The browser
        // URL must be built from the repository web URL instead.
        _links: {
          web: { href: 'https://dev.azure.com/acme/p/_apis/git/repositories/r/pullRequests/42' }
        },
        repository: { webUrl: 'https://dev.azure.com/acme/p/_git/r' },
        createdBy: { displayName: 'Ada Lovelace' },
        policyEvaluations: [{ status: 'approved' }]
      })
    ).toEqual({
      number: 42,
      title: 'Ship the skyline',
      headRef: 'feature/skyline',
      baseRef: 'develop',
      state: 'OPEN',
      isDraft: true,
      url: 'https://dev.azure.com/acme/p/_git/r/pullrequest/42',
      author: 'Ada Lovelace',
      ci: 'passing'
    })
  })

  it('parses both a bare array and Azure value envelope', () => {
    const fixture = JSON.stringify({
      value: [
        {
          pullRequestId: 1,
          title: 'One',
          sourceRefName: 'refs/heads/one',
          targetRefName: 'refs/heads/main',
          status: 'active'
        }
      ]
    })
    expect(parsePrList(fixture)).toHaveLength(1)
    expect(parsePrList(JSON.stringify(JSON.parse(fixture).value))).toHaveLength(1)
    expect(parsePrList('not json')).toEqual([])
  })

  it('normalizes Azure REST paths to Git-relative paths', () => {
    expect(
      parsePrFiles(
        JSON.stringify({
          changeEntries: [{ item: { path: '/src/one.ts' } }, { item: { path: 'README.md' } }]
        })
      )
    ).toEqual([
      { path: 'src/one.ts', additions: 0, deletions: 0 },
      { path: 'README.md', additions: 0, deletions: 0 }
    ])
  })
})

describe('Azure DevOps CI state', () => {
  it('maps policy evaluation states and gives failures precedence', () => {
    expect(deriveCi([{ status: 'approved' }])).toBe('passing')
    expect(deriveCi([{ status: 'running' }])).toBe('pending')
    expect(deriveCi([{ status: 'running' }, { status: 'rejected' }])).toBe('failing')
    expect(deriveCi([{ status: 'notApplicable' }])).toBe('none')
    expect(deriveCi({ value: [{ status: 'succeeded' }] })).toBe('passing')
  })

  it('uses a completed build result instead of its lifecycle status', () => {
    expect(deriveCi([{ status: 'completed', result: 'failed' }])).toBe('failing')
    expect(deriveCi([{ status: 'completed', result: 'canceled' }])).toBe('failing')
    expect(deriveCi([{ status: 'completed', result: 'succeeded' }])).toBe('passing')
  })

  it('does not treat unresolved Azure states as passing', () => {
    expect(deriveCi([{ status: 'notSet' }])).toBe('pending')
    expect(deriveCi([{ status: 'cancelling' }])).toBe('pending')
    expect(deriveCi([{ status: 'unknown' }])).toBe('pending')
    expect(deriveCi([{ status: 'newStatusFromAzure' }])).toBe('pending')
    expect(deriveCi([{}])).toBe('none')
  })

  it('uses the latest status for a check context across PR iterations', () => {
    const statuses = [
      {
        id: 10,
        iterationId: 1,
        state: 'failed',
        context: { genre: 'build', name: 'ci' },
        updatedDate: '2024-01-01T00:00:00Z'
      },
      {
        id: 11,
        iterationId: 2,
        state: 'succeeded',
        context: { genre: 'build', name: 'ci' },
        updatedDate: '2024-01-02T00:00:00Z'
      }
    ]

    expect(deriveCi(statuses)).toBe('failing')
    expect(deriveCi(selectCurrentStatuses(statuses))).toBe('passing')
  })
})

describe('Azure DevOps provider CLI calls', () => {
  it('marks policy success plus status enrichment failure as incomplete', async () => {
    const result = await listWithCiFixtures(
      azureCiFixture('policy-success'),
      azureCiFixture('status-failure')
    )
    expect(result).toMatchObject({ ok: true, prs: [expect.objectContaining({ ci: 'pending' })] })
  })

  it('marks policy enrichment failure plus status success as incomplete', async () => {
    const result = await listWithCiFixtures(
      azureCiFixture('policy-failure'),
      azureCiFixture('status-success')
    )
    expect(result).toMatchObject({ ok: true, prs: [expect.objectContaining({ ci: 'pending' })] })
  })

  it('degrades to no CI state when both enrichment sources fail', async () => {
    const result = await listWithCiFixtures(
      azureCiFixture('policy-failure'),
      azureCiFixture('status-failure')
    )
    expect(result).toMatchObject({ ok: true, prs: [expect.objectContaining({ ci: 'none' })] })
  })

  it('treats a malformed source response as incomplete', async () => {
    const result = await listWithCiFixtures(
      azureCiFixture('policy-success'),
      azureCiFixture('status-malformed')
    )
    expect(result).toMatchObject({ ok: true, prs: [expect.objectContaining({ ci: 'pending' })] })
  })

  it.each(['status-empty-string', 'status-empty-object', 'status-empty-array'])(
    'treats a %s outcome as incomplete',
    async (statusFixture) => {
      const result = await listWithCiFixtures(
        azureCiFixture('policy-success'),
        azureCiFixture(statusFixture)
      )
      expect(result).toMatchObject({ ok: true, prs: [expect.objectContaining({ ci: 'pending' })] })
    }
  )

  it('lists, creates, checks out, and enriches the current branch PR', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.write('README.md', 'fixture\n')
    repo.commitAll('fixture')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'list') {
        return ok(
          JSON.stringify([
            {
              pullRequestId: 42,
              title: 'Current',
              sourceRefName: 'refs/heads/main',
              targetRefName: 'refs/heads/develop',
              status: 'active'
            }
          ])
        )
      }
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'policy') {
        return ok(
          JSON.stringify([{ configuration: { type: { displayName: 'Build' } }, status: 'approved' }])
        )
      }
      if (args[0] === 'devops' && args.includes('pullRequestStatuses')) {
        return azureCiFixture('status-success')
      }
      return ok('[]')
    }
    const provider = createAzureProvider(run)
    const listed = await provider.listPullRequests(repo.path)
    expect(listed.ok).toBe(true)
    const current = await provider.currentBranchPr(repo.path)
    expect(current?.ci).toBe('passing')
    await provider.createPr(repo.path, 'develop', 'Title', 'Body')
    await provider.checkoutPr(repo.path, 42)
    expect(calls.some((args) => args.includes('policy'))).toBe(true)
    expect(calls.some((args) => args.includes('--target-branch') && args.includes('develop'))).toBe(
      true
    )
    expect(calls.some((args) => args.includes('checkout') && args.includes('42'))).toBe(true)
  })

  it('degrades safely when policy status is unavailable', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.write('README.md', 'fixture\n')
    repo.commitAll('fixture')
    const run: CliRunner = async (_cwd, args) => {
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'list') {
        return ok(
          JSON.stringify([
            {
              pullRequestId: 7,
              title: 'No policy API',
              sourceRefName: 'refs/heads/main',
              targetRefName: 'refs/heads/develop',
              status: 'active'
            }
          ])
        )
      }
      return err('policy endpoint unavailable')
    }
    const current = await createAzureProvider(run).currentBranchPr(repo.path)
    expect(current?.ci).toBe('none')
  })

  it('probes repository access directly, without requiring az account login', async () => {
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      return ok(JSON.stringify({ id: 'repo-id' }))
    }
    const status = await createAzureProvider(run).status(
      '/repo',
      'https://dev.azure.com/acme/project/_git/repo'
    )
    expect(status).toMatchObject({ available: true, authed: true, isRepo: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('repos')
    expect(calls[0]).toContain('show')
    expect(calls[0]).not.toContain('account')
  })

  it('keeps Azure auth remediation valid for az devops login', async () => {
    const run: CliRunner = async () => err('ERROR: az devops login required (TF400813)')
    const status = await createAzureProvider(run).status(
      '/repo',
      'https://dev.azure.com/acme/project/_git/repo'
    )
    expect(status).toMatchObject({ available: true, authed: false, isRepo: false, hint: 'login' })
    expect(status.reason).toContain('az devops login')
    expect(status.reason).not.toContain('--hostname')
  })

  it('treats TF401019 access denial as an authentication problem', async () => {
    const run: CliRunner = async () =>
      err(
        'TF401019: The Git repository with name or identifier repo does not exist or you do not have permissions for the operation.'
      )
    const status = await createAzureProvider(run).status(
      '/repo',
      'https://dev.azure.com/acme/project/_git/repo'
    )
    expect(status).toMatchObject({ available: true, authed: false, isRepo: false, hint: 'login' })
    expect(status.reason).toContain('az devops login')
  })

  it('distinguishes a missing azure-devops extension from a missing az binary', async () => {
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      return err(
        "az: 'repos' is not in the 'az' command group. See 'az --help'. If the command is from an extension, make sure the corresponding extension is installed."
      )
    }
    const status = await createAzureProvider(run).status(
      '/repo',
      'https://dev.azure.com/acme/project/_git/repo'
    )
    expect(status).toMatchObject({ available: true, authed: false, isRepo: false, hint: 'install' })
    expect(status.reason).toContain('az extension add --name azure-devops')
    expect(calls).toHaveLength(1)
    expect(calls.flat()).not.toContain('extension')
  })

  it('enriches every listed PR with policy and build status', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'list') {
        return ok(
          JSON.stringify([
            { pullRequestId: 1, title: 'One', status: 'active' },
            { pullRequestId: 2, title: 'Two', status: 'active' }
          ])
        )
      }
      if (args[2] === 'policy') {
        return ok(
          JSON.stringify([{ configuration: { type: { displayName: 'Build' } }, status: 'approved' }])
        )
      }
      if (
        args[0] === 'devops' &&
        args.includes('pullRequestStatuses') &&
        args.includes('pullRequestId=2')
      ) {
        return ok(JSON.stringify([{ status: 'completed', result: 'failed' }]))
      }
      if (args[0] === 'devops' && args.includes('pullRequestStatuses')) {
        return azureCiFixture('status-success')
      }
      return ok('[]')
    }
    const result = await createAzureProvider(run).listPullRequests(repo.path)
    expect(result).toEqual({
      ok: true,
      prs: [
        expect.objectContaining({ number: 1, ci: 'passing' }),
        expect.objectContaining({ number: 2, ci: 'failing' })
      ],
      more: false
    })
    expect(calls.filter((args) => args[2] === 'policy')).toHaveLength(2)
    const statusCalls = calls.filter(
      (args) => args[0] === 'devops' && args.includes('pullRequestStatuses')
    )
    expect(statusCalls).toHaveLength(2)
    expect(statusCalls[0]).toEqual(
      expect.arrayContaining([
        '--organization',
        'https://dev.azure.com/acme',
        'project=project',
        'repositoryId=repo',
        'pullRequestId=1'
      ])
    )
    expect(calls.some((args) => args[2] === 'status')).toBe(false)
  })

  it('does not let an older failed status override the latest successful iteration', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    const run: CliRunner = async (_cwd, args) => {
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'list') {
        return ok(JSON.stringify([{ pullRequestId: 9, title: 'Latest CI', status: 'active' }]))
      }
      if (args[2] === 'policy') {
        return ok(
          JSON.stringify([
            {
              configuration: { type: { displayName: 'Minimum number of reviewers' } },
              status: 'approved'
            }
          ])
        )
      }
      if (args[0] === 'devops' && args.includes('pullRequestStatuses')) {
        return ok(
          JSON.stringify([
            {
              id: 1,
              iterationId: 1,
              state: 'failed',
              context: { genre: 'build', name: 'ci' }
            },
            {
              id: 2,
              iterationId: 2,
              state: 'succeeded',
              context: { genre: 'build', name: 'ci' }
            }
          ])
        )
      }
      return ok('[]')
    }

    await expect(createAzureProvider(run).listPullRequests(repo.path)).resolves.toMatchObject({
      ok: true,
      prs: [expect.objectContaining({ number: 9, ci: 'passing' })]
    })
  })

  it('rolls up build and status-check policies, not reviewer policies', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    const run: CliRunner = async (_cwd, args) => {
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'list') {
        return ok(JSON.stringify([{ pullRequestId: 1, title: 'One', status: 'active' }]))
      }
      if (args[2] === 'policy') {
        return ok(
          JSON.stringify([
            {
              configuration: { type: { displayName: 'Minimum number of reviewers' } },
              status: 'rejected'
            },
            { configuration: { type: { displayName: 'Build' } }, status: 'approved' }
          ])
        )
      }
      if (args[0] === 'devops' && args.includes('pullRequestStatuses')) {
        return azureCiFixture('status-success')
      }
      return ok('[]')
    }

    const result = await createAzureProvider(run).listPullRequests(repo.path)
    expect(result).toMatchObject({ ok: true, prs: [expect.objectContaining({ ci: 'passing' })] })
  })

  it('limits concurrent CI enrichment while preserving all PR results', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    let active = 0
    let maxActive = 0
    let ciCalls = 0
    const run: CliRunner = async (_cwd, args) => {
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'list') {
        return ok(
          JSON.stringify(
            Array.from({ length: 50 }, (_, index) => ({
              pullRequestId: index + 1,
              title: `PR ${index + 1}`,
              status: 'active'
            }))
          )
        )
      }
      ciCalls += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return ok('[]')
    }

    const result = await createAzureProvider(run).listPullRequests(repo.path)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.prs).toHaveLength(50)
    expect(result.prs.map((pr) => pr.number)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1)
    )
    // There is no list-wide CI endpoint: each PR needs one policy read and,
    // when a route is available, one status read. Keep the documented 2N
    // reads, but prove they remain bounded at six concurrent workers.
    expect(ciCalls).toBe(100)
    expect(maxActive).toBeLessThanOrEqual(6)
  })

  it('reads changed files from pull request iteration changeEntries', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'show') {
        return ok(
          JSON.stringify({
            repository: {
              id: 'repo-id',
              project: { id: 'project-id' },
              webUrl: 'https://dev.azure.com/acme/project/_git/repo'
            }
          })
        )
      }
      if (args[0] === 'devops' && args.includes('pullRequestIterations')) {
        return ok(JSON.stringify([{ id: 1 }, { id: 2 }]))
      }
      return ok(
        JSON.stringify({
          changeEntries: [{ item: { path: '/src/one.ts' } }, { item: { path: '/src/two.ts' } }]
        })
      )
    }
    const result = await createAzureProvider(run).pullRequestFiles(repo.path, 42)
    expect(result).toEqual({
      ok: true,
      files: [
        { path: 'src/one.ts', additions: 0, deletions: 0 },
        { path: 'src/two.ts', additions: 0, deletions: 0 }
      ]
    })
    expect(calls.some((args) => args[2] === 'iteration' && args[3] === 'list')).toBe(false)
    expect(
      calls.some(
        (args) =>
          args[0] === 'devops' &&
          args.includes('pullRequestIterations') &&
          args.includes('--organization') &&
          args.includes('https://dev.azure.com/acme') &&
          args.includes('project=project-id') &&
          args.includes('repositoryId=repo-id') &&
          args.includes('pullRequestId=42')
      )
    ).toBe(true)
    expect(
      calls.some(
        (args) =>
          args[0] === 'devops' &&
          args[1] === 'invoke' &&
          args.includes('pullRequestIterationChanges')
      )
    ).toBe(true)
  })

  it('uses route metadata from a legacy Azure SSH remote', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'git@vs-ssh.visualstudio.com:v3/acme/project/repo')
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'show') {
        return ok(
          JSON.stringify({
            repository: {
              id: 'repo-id',
              project: { id: 'project-id' },
              webUrl: 'https://dev.azure.com/acme/project/_git/repo'
            }
          })
        )
      }
      if (args[0] === 'devops' && args.includes('pullRequestIterations')) {
        return ok(JSON.stringify([{ id: 1 }]))
      }
      return ok(JSON.stringify({ changeEntries: [] }))
    }

    await expect(createAzureProvider(run).pullRequestFiles(repo.path, 42)).resolves.toMatchObject({
      ok: true
    })
    const iterationCall = calls.find(
      (args) => args[0] === 'devops' && args.includes('pullRequestIterations')
    )
    expect(iterationCall).toEqual(
      expect.arrayContaining([
        '--organization',
        'https://dev.azure.com/acme',
        'project=project-id',
        'repositoryId=repo-id'
      ])
    )
  })

  it('reads the latest iteration as the complete PR diff from iteration zero', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'show') {
        return ok(
          JSON.stringify({
            repository: {
              id: 'repo-id',
              project: { id: 'project-id' },
              webUrl: 'https://dev.azure.com/acme/project/_git/repo'
            }
          })
        )
      }
      if (args[0] === 'devops' && args.includes('pullRequestIterations')) {
        return ok(JSON.stringify({ value: [{ id: 1 }, { id: 2 }] }))
      }
      if (args.includes('iterationId=1')) {
        return ok(JSON.stringify({ changeEntries: [{ item: { path: '/historical.ts' } }] }))
      }
      return ok(JSON.stringify({ changeEntries: [{ item: { path: '/current.ts' } }] }))
    }

    await expect(createAzureProvider(run).pullRequestFiles(repo.path, 42)).resolves.toEqual({
      ok: true,
      files: [{ path: 'current.ts', additions: 0, deletions: 0 }]
    })
    const changeCalls = calls.filter(
      (args) => args[0] === 'devops' && args.includes('pullRequestIterationChanges')
    )
    expect(changeCalls).toHaveLength(1)
    expect(changeCalls[0]).toEqual(
      expect.arrayContaining(['iterationId=2', '$compareTo=0', '$top=2000'])
    )
  })

  it('follows iteration-change pagination', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.git('remote', 'add', 'origin', 'https://dev.azure.com/acme/project/_git/repo')
    const calls: string[][] = []
    const run: CliRunner = async (_cwd, args) => {
      calls.push(args)
      if (args[0] === 'repos' && args[1] === 'pr' && args[2] === 'show') {
        return ok(
          JSON.stringify({
            repository: {
              id: 'repo-id',
              project: { id: 'project-id' },
              webUrl: 'https://dev.azure.com/acme/project/_git/repo'
            }
          })
        )
      }
      if (args[0] === 'devops' && args.includes('pullRequestIterations')) {
        return ok(JSON.stringify([{ id: 2 }]))
      }
      if (args.includes('$skip=2')) {
        return ok(
          JSON.stringify({
            changeEntries: [{ item: { path: '/page-two.ts' } }],
            nextSkip: 0,
            nextTop: 0
          })
        )
      }
      return ok(
        JSON.stringify({
          changeEntries: [{ item: { path: '/page-one.ts' } }],
          nextSkip: 2,
          nextTop: 2000
        })
      )
    }

    await expect(createAzureProvider(run).pullRequestFiles(repo.path, 42)).resolves.toEqual({
      ok: true,
      files: [
        { path: 'page-one.ts', additions: 0, deletions: 0 },
        { path: 'page-two.ts', additions: 0, deletions: 0 }
      ]
    })
    const changeCalls = calls.filter(
      (args) => args[0] === 'devops' && args.includes('pullRequestIterationChanges')
    )
    expect(changeCalls).toHaveLength(2)
    expect(changeCalls[1]).toEqual(
      expect.arrayContaining(['$skip=2', '$top=2000', '$compareTo=0'])
    )
  })

  it('reports unavailable changed files instead of a false empty success', async () => {
    const run: CliRunner = async () => ok('{}')
    await expect(createAzureProvider(run).pullRequestFiles('/repo', 42)).resolves.toEqual({
      ok: false,
      reason: "Couldn't read changed files from Azure DevOps. Try ↻."
    })
  })
})
