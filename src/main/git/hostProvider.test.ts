import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createGithubProvider } from './github'
import { createGitlabProvider } from './gitlab'
import { createAzureProvider } from './azure'
import { probeHost, providerFor } from './host'
import { CLI_TIMEOUT_MS, TIMED_OUT } from './cliFailure'
import type { CliResult, CliRunner } from './cliRunner'
import { makeTempRepo } from './fixtures'
import type { HostProvider } from './host'

/**
 * The HostProvider layer, driven entirely through fake runners.
 *
 * `runGh`/`runGlab` used to spawn a hard-coded binary from inside each
 * adapter, so none of this — both `status`es, the PR plumbing, the failure
 * wording, `probeHost` — could be tested at all (#109). The runner is now a
 * parameter, the way `clone.ts` injects `originOf`: nothing here spawns a
 * real `gh` or `glab`. The real runner's own mechanics (PATH repair, ENOENT,
 * the 20 s timeout) are covered in `cliRunner.test.ts`.
 */

const GH_MISSING =
  "GitHub CLI (gh) not found. If it is installed, Git City cannot see it on this app's PATH."
const GL_MISSING =
  "GitLab CLI (glab) not found. If it is installed, Git City cannot see it on this app's PATH."

// ——— fake runner plumbing ———————————————————————————————————————————————

const ok = (stdout = ''): CliResult => ({ code: 0, stdout, stderr: '', missing: false })
const err = (stderr: string, code = 1): CliResult => ({ code, stdout: '', stderr, missing: false })
const notInstalled = (): CliResult => ({
  code: -1,
  stdout: '',
  stderr: 'spawn: no such file',
  missing: true
})
/** What the real runner resolves with when it kills a child that hung. */
const hung = (): CliResult => ({ code: -1, stdout: '', stderr: `\n${TIMED_OUT}`, missing: false })

interface Call {
  cwd: string
  args: string[]
}

/** Route fake responses by subcommand (args[0]) and record every call. */
function fakeCli(routes: Record<string, (args: string[]) => CliResult>): {
  run: CliRunner
  calls: Call[]
} {
  const calls: Call[] = []
  const run: CliRunner = async (cwd, args) => {
    calls.push({ cwd, args })
    const handler = routes[args[0]]
    return handler ? handler(args) : err(`unexpected call: ${args.join(' ')}`)
  }
  return { run, calls }
}

/** A provider whose every method fails the test if it is ever reached. */
const neverProvider = (kind: 'github' | 'gitlab'): HostProvider => ({
  kind,
  status: () => {
    throw new Error(`${kind} should not have been probed`)
  },
  listPullRequests: () => {
    throw new Error(`${kind} should not have been probed`)
  },
  currentBranchPr: () => {
    throw new Error(`${kind} should not have been probed`)
  },
  pullRequestFiles: () => {
    throw new Error(`${kind} should not have been probed`)
  },
  checkoutPr: () => {
    throw new Error(`${kind} should not have been probed`)
  },
  createPr: () => {
    throw new Error(`${kind} should not have been probed`)
  }
})

const singlePr = (base: 'gh' | 'gl', extra: Record<string, unknown> = {}): string =>
  JSON.stringify(
    base === 'gh'
      ? {
          number: 0,
          title: 'PR 0',
          headRefName: 'pr-0',
          baseRefName: 'main',
          url: 'https://github.com/o/r/pull/0',
          ...extra
        }
      : {
          iid: 0,
          title: 'MR 0',
          source_branch: 'mr-0',
          target_branch: 'main',
          web_url: 'https://gitlab.com/g/r/-/merge_requests/0',
          ...extra
        }
  )

// ——— fixture repos (for the git-facing bits: gitlab's currentBranch, probeHost's origin) ——

const created: string[] = []
function tempRepo(origin?: string): string {
  const repo = makeTempRepo('git-city-provider-')
  created.push(repo.path)
  // one commit, so HEAD resolves: gitlab's currentBranchPr asks git for it
  repo.write('README.md', 'x\n')
  repo.commitAll('init')
  if (origin) repo.git('remote', 'add', 'origin', origin)
  return repo.path
}
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

const pageOf = (n: number, base: string): string =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) =>
      base === 'gh'
        ? {
            number: i,
            title: `PR ${i}`,
            headRefName: `pr-${i}`,
            baseRefName: 'main',
            url: `https://github.com/o/r/pull/${i}`
          }
        : {
            iid: i,
            title: `MR ${i}`,
            source_branch: `mr-${i}`,
            target_branch: 'main',
            web_url: `https://gitlab.com/g/r/-/merge_requests/${i}`
          }
    )
  )

// ——— github provider ————————————————————————————————————————————————————

describe('github provider (fake runner)', () => {
  it('status: says install when gh is not on PATH', async () => {
    const gh = createGithubProvider(async () => notInstalled())
    expect(await gh.status('/anywhere')).toEqual({
      host: 'github',
      available: false,
      authed: false,
      isRepo: false,
      login: null,
      reason: GH_MISSING,
      hint: 'install'
    })
  })

  it('status: says check your network, not "log in", when gh is offline (#24)', async () => {
    const gh = createGithubProvider(async () =>
      err('dial tcp: lookup api.github.com: no such host')
    )
    const auth = await gh.status('/anywhere')
    expect(auth.available).toBe(true)
    expect(auth.authed).toBe(false)
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe("Can't reach GitHub — check your network connection, then ↻.")
  })

  it('status: names the 20s timeout when gh never answered (#24)', async () => {
    const gh = createGithubProvider(async () => hung())
    const auth = await gh.status('/anywhere')
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe(
      `GitHub didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
    )
  })

  it('status: says log in when gh answered and refused', async () => {
    const gh = createGithubProvider(async () => err('You are not logged into any GitHub hosts.'))
    const auth = await gh.status('/anywhere')
    expect(auth.hint).toBe('login')
    expect(auth.reason).toBe('Not logged in to GitHub — run: gh auth login')
  })

  it('status: claims the repository and extracts the account', async () => {
    const { run, calls } = fakeCli({
      auth: () => ok('✓ Logged in to github.com account max (keyring)'),
      repo: () => ok(JSON.stringify({ nameWithOwner: 'maximalcode/git-city' }))
    })
    const auth = await createGithubProvider(run).status('/anywhere')
    expect(auth).toEqual({
      host: 'github',
      available: true,
      authed: true,
      isRepo: true,
      login: 'max',
      reason: null
    })
    expect(calls.map((c) => c.args[0])).toEqual(['auth', 'repo'])
  })

  it('status: repo probe refused → names the enterprise host from the origin (#24)', async () => {
    const { run } = fakeCli({
      auth: () => ok('account max'),
      repo: () => err('HTTP 401: Bad credentials')
    })
    const auth = await createGithubProvider(run).status(
      '/anywhere',
      'https://github.acme.com/o/r.git'
    )
    expect(auth.authed).toBe(true)
    expect(auth.isRepo).toBe(false)
    expect(auth.hint).toBe('login')
    expect(auth.reason).toBe(
      'gh is not logged in to github.acme.com — run: gh auth login --hostname github.acme.com'
    )
  })

  it('status: repo probe refused with no hostname → the generic login line', async () => {
    const { run } = fakeCli({
      auth: () => ok('account max'),
      repo: () => err('HTTP 401: Bad credentials')
    })
    const auth = await createGithubProvider(run).status('/anywhere')
    expect(auth.reason).toBe('gh is not logged in to this host — run: gh auth login')
  })

  it('status: repo probe finds no GitHub remote', async () => {
    const { run } = fakeCli({
      auth: () => ok('account max'),
      repo: () => err('no such remote: origin')
    })
    const auth = await createGithubProvider(run).status('/anywhere', 'git@github.com:o/r.git')
    expect(auth.isRepo).toBe(false)
    expect(auth.hint).toBe('none')
    expect(auth.reason).toBe('This repository has no GitHub remote.')
  })

  it('status: repo probe offline → the reachability wording, not "no remote" (#24)', async () => {
    const { run } = fakeCli({
      auth: () => ok('account max'),
      repo: () => err('connection refused')
    })
    const auth = await createGithubProvider(run).status('/anywhere')
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe("Can't reach GitHub — check your network connection, then ↻.")
  })

  it('status: repo probe fails with something else → shows gh first line', async () => {
    const { run } = fakeCli({
      auth: () => ok('account max'),
      repo: () => err('error: GraphQL:并不是 (x)')
    })
    const auth = await createGithubProvider(run).status('/anywhere')
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe('gh could not read this repository (GraphQL:并不是 (x))')
  })

  it('listPullRequests: maps and caps the page, saying there is more', async () => {
    const { run } = fakeCli({ pr: () => ok(pageOf(51, 'gh')) })
    const res = await createGithubProvider(run).listPullRequests('/anywhere')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.prs).toHaveLength(50)
    expect(res.more).toBe(true)
    expect(res.prs[0]).toEqual({
      number: 0,
      title: 'PR 0',
      headRef: 'pr-0',
      baseRef: 'main',
      state: 'OPEN',
      isDraft: false,
      url: 'https://github.com/o/r/pull/0',
      author: '',
      ci: 'none'
    })
  })

  it('listPullRequests: an uncapped page reports more: false', async () => {
    const { run } = fakeCli({ pr: () => ok(pageOf(2, 'gh')) })
    const res = await createGithubProvider(run).listPullRequests('/anywhere')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.prs).toHaveLength(2)
    expect(res.more).toBe(false)
  })

  it('listPullRequests: every failure wording keeps its exact string (#109)', async () => {
    const wording = async (res: CliResult): Promise<string> => {
      const out = await createGithubProvider(async () => res).listPullRequests('/anywhere')
      return out.ok ? 'unexpectedly ok' : out.reason
    }
    expect(await wording(notInstalled())).toBe(GH_MISSING)
    expect(await wording(hung())).toBe(
      `gh didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
    )
    expect(await wording(err('dial tcp: no such host'))).toBe(
      "Couldn't reach GitHub — check your network, then ↻."
    )
    expect(await wording(err('error: 502 who knows'))).toBe(
      "Couldn't reach GitHub: 502 who knows Try ↻."
    )
    expect(await wording(err('  \n  '))).toBe("Couldn't reach GitHub. Try ↻.")
  })

  it('listPullRequests: unreadable JSON is an error, not an empty list (#24)', async () => {
    const { run } = fakeCli({ pr: () => ok('not json') })
    const res = await createGithubProvider(run).listPullRequests('/anywhere')
    expect(res).toEqual({ ok: false, reason: "Couldn't read the response from gh. Try ↻." })
  })

  it('currentBranchPr: maps the open PR for the current branch', async () => {
    // `gh pr view` answers with one object, unlike `pr list`'s array
    const { run } = fakeCli({
      pr: (args) => (args[1] === 'view' ? ok(singlePr('gh')) : ok(pageOf(1, 'gh')))
    })
    const pr = await createGithubProvider(run).currentBranchPr('/anywhere')
    expect(pr).not.toBeNull()
    expect(pr?.number).toBe(0)
    expect(pr?.state).toBe('OPEN')
  })

  it('currentBranchPr: null for a merged PR, a failed call, and unreadable JSON', async () => {
    const merged = fakeCli({ pr: () => ok(singlePr('gh', { state: 'MERGED' })) })
    expect(await createGithubProvider(merged.run).currentBranchPr('/anywhere')).toBeNull()
    const failed = fakeCli({ pr: () => err('boom') })
    expect(await createGithubProvider(failed.run).currentBranchPr('/anywhere')).toBeNull()
    const junk = fakeCli({ pr: () => ok('not json') })
    expect(await createGithubProvider(junk.run).currentBranchPr('/anywhere')).toBeNull()
  })

  it('pullRequestFiles: maps the changed files, and words the failure (#24)', async () => {
    const files = fakeCli({
      pr: () => ok(JSON.stringify({ files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }] }))
    })
    const res = await createGithubProvider(files.run).pullRequestFiles('/anywhere', 42)
    expect(res).toEqual({ ok: true, files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }] })

    const failed = fakeCli({ pr: () => err('dial tcp: no such host') })
    const bad = await createGithubProvider(failed.run).pullRequestFiles('/anywhere', 42)
    expect(bad).toEqual({
      ok: false,
      reason: "Couldn't reach GitHub — check your network, then ↻."
    })
  })

  it('checkoutPr: ok, stderr, missing CLI, and the fallback wording', async () => {
    const good = createGithubProvider(async () => ok('switched'))
    expect(await good.checkoutPr('/anywhere', 7)).toEqual({ ok: true })

    const bad = createGithubProvider(async () => err('some failure\n'))
    expect(await bad.checkoutPr('/anywhere', 7)).toEqual({
      ok: false,
      code: 'unknown',
      message: 'some failure'
    })

    const absent = createGithubProvider(async () => notInstalled())
    expect((await absent.checkoutPr('/anywhere', 7)).message).toBe(GH_MISSING)

    const silent = createGithubProvider(async () => err(''))
    expect(await silent.checkoutPr('/anywhere', 7)).toEqual({
      ok: false,
      code: 'unknown',
      message: 'Could not check out the pull request.'
    })
  })

  it('createPr: passes title/body/base, words the failure', async () => {
    const { run, calls } = fakeCli({ pr: () => ok('') })
    expect(await createGithubProvider(run).createPr('/anywhere', 'main', 'T', 'B')).toEqual({
      ok: true
    })
    expect(calls[0].args).toEqual(['pr', 'create', '--title', 'T', '--body', 'B', '--base', 'main'])

    const noBase = fakeCli({ pr: () => ok('') })
    await createGithubProvider(noBase.run).createPr('/anywhere', '', 'T', 'B')
    expect(noBase.calls[0].args).toEqual(['pr', 'create', '--title', 'T', '--body', 'B'])

    const failed = createGithubProvider(async () => err(''))
    expect(await failed.createPr('/anywhere', 'main', 'T', 'B')).toEqual({
      ok: false,
      code: 'unknown',
      message: 'Could not create the pull request.'
    })
  })
})

// ——— gitlab provider ————————————————————————————————————————————————————

describe('gitlab provider (fake runner)', () => {
  it('status: says install when glab is not on PATH', async () => {
    const gl = createGitlabProvider(async () => notInstalled())
    expect(await gl.status('/anywhere')).toEqual({
      host: 'gitlab',
      available: false,
      authed: false,
      isRepo: false,
      login: null,
      reason: GL_MISSING,
      hint: 'install'
    })
  })

  it('status: says check your network, not "log in", when glab is offline (#24)', async () => {
    const gl = createGitlabProvider(async () => err('dial tcp: lookup gitlab.com: no such host'))
    const auth = await gl.status('/anywhere')
    expect(auth.available).toBe(true)
    expect(auth.authed).toBe(false)
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe("Can't reach GitLab — check your network connection, then ↻.")
  })

  it('status: names the 20s timeout when glab never answered (#24)', async () => {
    const gl = createGitlabProvider(async () => hung())
    const auth = await gl.status('/anywhere')
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe(
      `GitLab didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
    )
  })

  it('status: says log in when glab answered and refused', async () => {
    const gl = createGitlabProvider(async () => err('401 Unauthorized'))
    const auth = await gl.status('/anywhere')
    expect(auth.hint).toBe('login')
    expect(auth.reason).toBe('Not logged in to GitLab — run: glab auth login')
  })

  it('status: claims the project and reads the username from /user', async () => {
    const { run, calls } = fakeCli({
      auth: () => ok(''),
      api: (args) => (args[1] === 'projects/:fullpath' ? ok('{}') : ok('{"username":"ada"}'))
    })
    const auth = await createGitlabProvider(run).status('/anywhere')
    expect(auth).toEqual({
      host: 'gitlab',
      available: true,
      authed: true,
      isRepo: true,
      login: 'ada',
      reason: null
    })
    expect(calls.map((c) => c.args.join(' '))).toEqual([
      'auth status',
      'api projects/:fullpath',
      'api user'
    ])
  })

  it('status: a failed /user leaves login null without un-claiming the repo', async () => {
    const { run } = fakeCli({
      auth: () => ok(''),
      api: (args) => (args[1] === 'projects/:fullpath' ? ok('{}') : err('500'))
    })
    const auth = await createGitlabProvider(run).status('/anywhere')
    expect(auth.isRepo).toBe(true)
    expect(auth.login).toBeNull()
  })

  it('status: project probe 404 → no GitLab remote (#24)', async () => {
    const { run } = fakeCli({ auth: () => ok(''), api: () => err('404 Not found') })
    const auth = await createGitlabProvider(run).status('/anywhere', 'https://gitlab.com/g/r.git')
    expect(auth.authed).toBe(true)
    expect(auth.isRepo).toBe(false)
    expect(auth.hint).toBe('none')
    expect(auth.reason).toBe('This repository has no GitLab remote.')
  })

  it('status: project probe 401 → names the self-hosted host from the origin', async () => {
    const { run } = fakeCli({ auth: () => ok(''), api: () => err('HTTP 401 Unauthorized') })
    const auth = await createGitlabProvider(run).status('/anywhere', 'git@gitlab.acme.com:g/r.git')
    expect(auth.hint).toBe('login')
    expect(auth.reason).toBe(
      'glab is not logged in to gitlab.acme.com — run: glab auth login --hostname gitlab.acme.com'
    )
  })

  it('status: project probe offline → reachability, not "no remote" (#24)', async () => {
    const { run } = fakeCli({ auth: () => ok(''), api: () => err('connection refused') })
    const auth = await createGitlabProvider(run).status('/anywhere')
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe("Can't reach GitLab — check your network connection, then ↻.")
  })

  it('status: project probe fails with something else → shows glab first line', async () => {
    const { run } = fakeCli({ auth: () => ok(''), api: () => err('error: 500 who knows') })
    const auth = await createGitlabProvider(run).status('/anywhere')
    expect(auth.hint).toBe('retry')
    expect(auth.reason).toBe('glab could not read this project (500 who knows)')
  })

  it('listPullRequests: reads the REST page and caps it, saying there is more', async () => {
    const { run, calls } = fakeCli({ api: () => ok(pageOf(51, 'gl')) })
    const res = await createGitlabProvider(run).listPullRequests('/anywhere')
    expect(calls[0].args[1]).toBe('projects/:fullpath/merge_requests?state=opened&per_page=51')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.prs).toHaveLength(50)
    expect(res.more).toBe(true)
    expect(res.prs[0]).toEqual({
      number: 0,
      title: 'MR 0',
      headRef: 'mr-0',
      baseRef: 'main',
      state: 'OPEN',
      isDraft: false,
      url: 'https://gitlab.com/g/r/-/merge_requests/0',
      author: '',
      ci: 'none'
    })
  })

  it('listPullRequests: every failure wording keeps its exact string (#109)', async () => {
    const wording = async (res: CliResult): Promise<string> => {
      const out = await createGitlabProvider(async () => res).listPullRequests('/anywhere')
      return out.ok ? 'unexpectedly ok' : out.reason
    }
    expect(await wording(notInstalled())).toBe(GL_MISSING)
    expect(await wording(hung())).toBe(
      `glab didn't respond within ${CLI_TIMEOUT_MS / 1000}s — check your network or VPN, then ↻.`
    )
    expect(await wording(err('dial tcp: no such host'))).toBe(
      "Couldn't reach GitLab — check your network, then ↻."
    )
    expect(await wording(err('error: 502 who knows'))).toBe(
      "Couldn't reach GitLab: 502 who knows Try ↻."
    )
    expect(await wording(err('  \n  '))).toBe("Couldn't reach GitLab. Try ↻.")
  })

  it('currentBranchPr: fetches by branch, then re-fetches by iid for the pipeline', async () => {
    const repo = tempRepo()
    const { run, calls } = fakeCli({
      api: (args) => {
        const url = args[1] ?? ''
        if (url.includes('source_branch=')) {
          return ok(pageOf(1, 'gl'))
        }
        if (/\/merge_requests\/\d+$/.test(url)) {
          return ok(
            JSON.stringify({
              iid: 0,
              title: 'full',
              source_branch: 'mr-0',
              target_branch: 'main',
              state: 'opened',
              web_url: 'https://gitlab.com/g/r/-/merge_requests/0',
              head_pipeline: { status: 'success' }
            })
          )
        }
        return err(`unexpected ${url}`)
      }
    })
    const pr = await createGitlabProvider(run).currentBranchPr(repo)
    expect(pr?.title).toBe('full')
    expect(pr?.ci).toBe('passing')
    expect(calls).toHaveLength(2)
  })

  it('currentBranchPr: falls back to the list entry when the detail call fails', async () => {
    const repo = tempRepo()
    const { run } = fakeCli({
      api: (args) => {
        const url = args[1] ?? ''
        if (url.includes('source_branch=')) return ok(pageOf(1, 'gl'))
        return err('500')
      }
    })
    const pr = await createGitlabProvider(run).currentBranchPr(repo)
    expect(pr?.title).toBe('MR 0')
  })

  it('currentBranchPr: null on a detached HEAD, without calling the CLI', async () => {
    const repo = makeTempRepo('git-city-provider-detached-')
    created.push(repo.path)
    repo.write('f.txt', 'x\n')
    repo.commitAll('init')
    repo.git('checkout', '--detach')
    const { run, calls } = fakeCli({})
    expect(await createGitlabProvider(run).currentBranchPr(repo.path)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('currentBranchPr: null outside a git repo, without calling the CLI', async () => {
    // an existing directory that git reports "not a repository" for — a
    // *missing* directory makes runGitResult throw instead (pre-existing)
    const plain = mkdtempSync(join(tmpdir(), 'git-city-provider-plain-'))
    created.push(plain)
    const { run, calls } = fakeCli({})
    expect(await createGitlabProvider(run).currentBranchPr(plain)).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('pullRequestFiles: counts the changes diff, and words the failure (#24)', async () => {
    const repo = tempRepo()
    const changes = fakeCli({
      api: () =>
        ok(
          JSON.stringify({
            changes: [{ new_path: 'src/a.ts', diff: '@@\n+one\n+two\n-old\n' }]
          })
        )
    })
    const res = await createGitlabProvider(changes.run).pullRequestFiles(repo, 7)
    expect(res).toEqual({ ok: true, files: [{ path: 'src/a.ts', additions: 2, deletions: 1 }] })

    const failed = fakeCli({ api: () => err('dial tcp: no such host') })
    const bad = await createGitlabProvider(failed.run).pullRequestFiles(repo, 7)
    expect(bad).toEqual({
      ok: false,
      reason: "Couldn't reach GitLab — check your network, then ↻."
    })
  })

  it('checkoutPr: ok, stderr, missing CLI, and the fallback wording', async () => {
    const good = createGitlabProvider(async () => ok('switched'))
    expect(await good.checkoutPr('/anywhere', 7)).toEqual({ ok: true })

    const bad = createGitlabProvider(async () => err('some failure'))
    expect(await bad.checkoutPr('/anywhere', 7)).toEqual({
      ok: false,
      code: 'unknown',
      message: 'some failure'
    })

    const absent = createGitlabProvider(async () => notInstalled())
    expect((await absent.checkoutPr('/anywhere', 7)).message).toBe(GL_MISSING)

    const silent = createGitlabProvider(async () => err(''))
    expect(await silent.checkoutPr('/anywhere', 7)).toEqual({
      ok: false,
      code: 'unknown',
      message: 'Could not check out the merge request.'
    })
  })

  it('createPr: passes title/description/target, words the failure', async () => {
    const { run, calls } = fakeCli({ mr: () => ok('') })
    expect(await createGitlabProvider(run).createPr('/anywhere', 'main', 'T', 'B')).toEqual({
      ok: true
    })
    expect(calls[0].args).toEqual([
      'mr',
      'create',
      '--title',
      'T',
      '--description',
      'B',
      '--yes',
      '--target-branch',
      'main'
    ])

    const noBase = fakeCli({ mr: () => ok('') })
    await createGitlabProvider(noBase.run).createPr('/anywhere', '', 'T', 'B')
    expect(noBase.calls[0].args).toEqual([
      'mr',
      'create',
      '--title',
      'T',
      '--description',
      'B',
      '--yes'
    ])

    const failed = createGitlabProvider(async () => err(''))
    expect(await failed.createPr('/anywhere', 'main', 'T', 'B')).toEqual({
      ok: false,
      code: 'unknown',
      message: 'Could not create the merge request.'
    })
  })
})

// ——— probeHost / providerFor through the HostProvider interface —————————

describe('probeHost with injected providers (#109)', () => {
  it('does not route an unverified Azure-shaped SSH alias to Azure', async () => {
    const repoPath = tempRepo('git@devops_fabrikam:v3/Fabrikam/Project/repo')
    let calls = 0
    const azure = createAzureProvider(async () => {
      calls += 1
      return ok(JSON.stringify({ id: 'should-not-be-used' }))
    })
    const { provider } = await probeHost(repoPath, [azure])
    expect(provider).toBeNull()
    expect(calls).toBe(0)
  })

  it('does not let Azure defaults claim a neutral remote', async () => {
    const repoPath = tempRepo('https://git.acme.com/team/thing.git')
    let calls = 0
    const azure = createAzureProvider(async () => {
      calls += 1
      return ok(JSON.stringify({ id: 'configured-default-repository' }))
    })
    const { provider } = await probeHost(repoPath, [azure])
    expect(provider).toBeNull()
    expect(calls).toBe(0)
  })

  it('returns the claiming provider without asking the other one', async () => {
    const repoPath = tempRepo('https://git.acme.com/team/thing.git')
    // auth ok + projects/:fullpath ok → gitlab claims the repository
    const { run } = fakeCli({ auth: () => ok(''), api: () => ok('{}') })
    const gitlab = createGitlabProvider(run)
    const { provider, auth } = await probeHost(repoPath, [gitlab, neverProvider('github')])
    expect(provider).toBe(gitlab)
    expect(auth).toBeNull()
  })

  it('keeps the informative answer when nobody claims the repository', async () => {
    const repoPath = tempRepo('https://git.acme.com/team/thing.git')
    const offline = createGithubProvider(async () => err('connection refused'))
    const absent = createGitlabProvider(async () => notInstalled())
    const { provider, auth } = await probeHost(repoPath, [absent, offline])
    expect(provider).toBeNull()
    expect(auth?.host).toBe('github')
    expect(auth?.hint).toBe('retry')
    expect(auth?.reason).toBe("Can't reach GitHub — check your network connection, then ↻.")
  })

  it('says neither CLI is installed, naming the host, when both are missing', async () => {
    const repoPath = tempRepo('https://git.acme.com/team/thing.git')
    const absent = async (): Promise<CliResult> => notInstalled()
    const { provider, auth } = await probeHost(repoPath, [
      createGitlabProvider(absent),
      createGithubProvider(absent)
    ])
    expect(provider).toBeNull()
    expect(auth?.hint).toBe('install')
    expect(auth?.reason).toContain('Neither gh nor glab is installed')
    expect(auth?.reason).toContain('git.acme.com')
  })

  it('falls back to "no GitHub or GitLab remote" only when both said no', async () => {
    const repoPath = tempRepo('https://git.acme.com/team/thing.git')
    const saidNo = fakeCli({ auth: () => ok(''), api: () => err('404 Not found') })
    const ghSaidNo = fakeCli({
      auth: () => ok('account me'),
      repo: () => err('no such remote: origin')
    })
    const { provider, auth } = await probeHost(repoPath, [
      createGitlabProvider(saidNo.run),
      createGithubProvider(ghSaidNo.run)
    ])
    expect(provider).toBeNull()
    expect(auth?.reason).toBe('This repository has no GitHub or GitLab remote.')
  })

  it('remembers a negative probe for a moment instead of re-asking the CLIs', async () => {
    const repoPath = tempRepo('https://git.acme.com/team/thing.git')
    // neither candidate claims the repository, so the probe legitimately asks both
    const gl = fakeCli({ auth: () => ok(''), api: () => err('404 Not found') })
    const gh = fakeCli({ auth: () => err('not logged in to any hosts') })
    const gitlab = createGitlabProvider(gl.run)
    const github = createGithubProvider(gh.run)
    await probeHost(repoPath, [gitlab, github])
    const asked = gl.calls.length + gh.calls.length
    expect(asked).toBeGreaterThan(0)
    await probeHost(repoPath, [gitlab, github])
    expect(gl.calls.length + gh.calls.length).toBe(asked)
  })

  it('remembers a positive probe instead of re-asking the CLIs', async () => {
    const repoPath = tempRepo('https://git.acme.com/team/thing.git')
    const { run, calls } = fakeCli({ auth: () => ok(''), api: () => ok('{}') })
    const gitlab = createGitlabProvider(run)
    await probeHost(repoPath, [gitlab, neverProvider('github')])
    const afterFirst = calls.length
    await probeHost(repoPath, [gitlab, neverProvider('github')])
    expect(calls.length).toBe(afterFirst)
  })

  it('providerFor is just the claiming provider, or null', async () => {
    const claimed = tempRepo('https://git.acme.com/team/thing.git')
    const { run } = fakeCli({ auth: () => ok(''), api: () => ok('{}') })
    const gitlab = createGitlabProvider(run)
    const provider = await providerFor(claimed, [gitlab, neverProvider('github')])
    expect(provider?.kind).toBe('gitlab')

    const none = tempRepo('https://git.acme.com/team/other.git')
    const absent = async (): Promise<CliResult> => notInstalled()
    expect(
      await providerFor(none, [createGitlabProvider(absent), createGithubProvider(absent)])
    ).toBeNull()
  })

  it('a known hostname short-circuits to the built-in provider without any CLI call', async () => {
    const repoPath = tempRepo('https://github.com/o/r.git')
    const { provider, auth } = await probeHost(repoPath, [
      neverProvider('gitlab'),
      neverProvider('github')
    ])
    expect(provider?.kind).toBe('github')
    expect(auth).toBeNull()
  })
})
