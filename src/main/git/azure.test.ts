import { describe, expect, it } from 'vitest'
import { createAzureProvider, deriveCi, mapPr, parsePrList } from './azure'
import type { CliResult, CliRunner } from './cliRunner'
import { makeTempRepo } from './fixtures'

const ok = (stdout = ''): CliResult => ({ code: 0, stdout, stderr: '', missing: false })
const err = (stderr: string): CliResult => ({ code: 1, stdout: '', stderr, missing: false })

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
        _links: { web: { href: 'https://dev.azure.com/acme/p/_git/r/pullrequest/42' } },
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
})

describe('Azure DevOps CI state', () => {
  it('maps policy evaluation states and gives failures precedence', () => {
    expect(deriveCi([{ status: 'approved' }])).toBe('passing')
    expect(deriveCi([{ status: 'running' }])).toBe('pending')
    expect(deriveCi([{ status: 'running' }, { status: 'rejected' }])).toBe('failing')
    expect(deriveCi([{ status: 'notApplicable' }])).toBe('none')
    expect(deriveCi({ value: [{ status: 'succeeded' }] })).toBe('passing')
  })
})

describe('Azure DevOps provider CLI calls', () => {
  it('lists, creates, checks out, and enriches the current branch PR', async () => {
    const repo = makeTempRepo('git-city-azure-')
    repo.write('README.md', 'fixture\n')
    repo.commitAll('fixture')
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
        return ok(JSON.stringify([{ status: 'approved' }]))
      }
      return ok()
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
})
