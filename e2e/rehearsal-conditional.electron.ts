import { test, expect, _electron as electron, type TestInfo } from '@playwright/test'
import { execFileSync } from 'child_process'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { reviewedApplyRequest } from './rehearsal-review-assertions'
import type { RehearsalApplyRequest, RehearsalReport } from '../src/shared/types'

type EvidenceResult<T> = { ok: true; value: T } | { ok: false; error: string }

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const evidence = async <T>(operation: () => T | Promise<T>): Promise<EvidenceResult<T>> => {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

const gitOutput = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

const isWithin = (parent: string, candidate: string): boolean => {
  const pathFromParent = relative(parent, candidate)
  return (
    pathFromParent === '' ||
    (!isAbsolute(pathFromParent) &&
      !pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== '..')
  )
}

async function preserveFailureEvidence(input: {
  testInfo: TestInfo
  tool: string
  root: string
  cache: string
  mutation: string
  failure: unknown
  report?: RehearsalReport
  request?: RehearsalApplyRequest
  refsBeforeMutation?: EvidenceResult<{ origin: string; sandbox: string }>
  refsAfterMutation?: EvidenceResult<{ origin: string; sandbox: string }>
  chosenRef?: string
  changedOid?: string
}): Promise<void> {
  const { testInfo, tool, root, cache, mutation, failure, report, request } = input
  const outputDir = testInfo.outputPath('conditional-apply-diagnostics')
  const mkdirResult = await evidence(() => mkdir(outputDir, { recursive: true }))
  if (!mkdirResult.ok) {
    console.error(`Could not create conditional Apply evidence directory: ${mkdirResult.error}`)
    return
  }

  const repoArchive = join(outputDir, 'synthetic-repository.tar.gz')
  const cacheArchive = join(outputDir, 'synthetic-rehearsal-cache.tar.gz')
  const repoCopy = join(outputDir, 'synthetic-repository')
  const cacheCopy = join(outputDir, 'synthetic-rehearsal-cache')
  const repoCopyResult = await evidence(() => cp(root, repoCopy, { recursive: true }))
  const cacheCopyResult = await evidence(() => cp(cache, cacheCopy, { recursive: true }))
  const repoArchiveResult = repoCopyResult.ok
    ? await evidence(async () => {
        execFileSync('tar', ['-czf', repoArchive, '-C', outputDir, 'synthetic-repository'])
        return repoArchive
      })
    : { ok: false as const, error: 'Repository copy failed.' }
  const cacheArchiveResult = cacheCopyResult.ok
    ? await evidence(async () => {
        execFileSync('tar', ['-czf', cacheArchive, '-C', outputDir, 'synthetic-rehearsal-cache'])
        return cacheArchive
      })
    : { ok: false as const, error: 'Rehearsal cache copy failed.' }

  const endpoints = report?.result_endpoints
  const publicOids = new Set<string>([
    ...Object.values(endpoints?.pre_state ?? {}),
    ...Object.values(endpoints?.results ?? {}),
    endpoints?.carried?.snapshot ?? '',
    endpoints?.carried?.snapshot_ref ?? '',
    endpoints?.carried?.replay ?? '',
    endpoints?.carried?.replay_ref ?? '',
    input.changedOid ?? '',
    ...(errorText(failure).match(/\b[0-9a-f]{40,64}\b/g) ?? [])
  ])
  publicOids.delete('')

  const objectVisibility: Record<string, Record<string, EvidenceResult<string>>> = {}
  const commitParents: Record<string, EvidenceResult<string>> = {}
  for (const [label, cwd] of [
    ['origin', root],
    ['sandbox', report?.sandbox]
  ] as const) {
    if (!cwd) {
      objectVisibility[label] = {}
      continue
    }
    const visibility: Record<string, EvidenceResult<string>> = {}
    for (const oid of publicOids) {
      visibility[oid] = await evidence(() => gitOutput(cwd, 'cat-file', '-e', `${oid}^{object}`))
    }
    objectVisibility[label] = visibility
    if (input.changedOid) {
      commitParents[label] = await evidence(() =>
        gitOutput(cwd, 'show', '-s', '--format=%H %P', input.changedOid!)
      )
    }
  }

  const gitPaths = {
    executable: await evidence(() => execFileSync('which', ['git'], { encoding: 'utf8' }).trim()),
    version: await evidence(() => gitOutput(root, '--version')),
    buildOptions: await evidence(() => gitOutput(root, 'version', '--build-options')),
    originRealpath: await evidence(() => realpath(root)),
    sandboxPath: report?.sandbox,
    sandboxRealpath: report?.sandbox ? await evidence(() => realpath(report.sandbox!)) : undefined,
    originGit: await evidence(() =>
      gitOutput(root, 'rev-parse', '--git-dir', '--git-common-dir', '--show-object-format')
    ),
    sandboxGit: report?.sandbox
      ? await evidence(() =>
          gitOutput(
            report.sandbox!,
            'rev-parse',
            '--git-dir',
            '--git-common-dir',
            '--show-object-format'
          )
        )
      : undefined
  }
  const diagnostic = {
    mutation,
    failure:
      failure instanceof Error
        ? { message: failure.message, stack: failure.stack }
        : errorText(failure),
    tool,
    gitPaths,
    report,
    applyRequest: request,
    refsBeforeMutation: input.refsBeforeMutation,
    refsAfterMutation: input.refsAfterMutation,
    chosenRef: input.chosenRef,
    changedOid: input.changedOid,
    publicOids: [...publicOids],
    objectVisibility,
    changedCommitParents: commitParents,
    preservedFiles: {
      repository: { copy: repoCopyResult, archive: repoArchiveResult },
      rehearsalCache: { copy: cacheCopyResult, archive: cacheArchiveResult }
    }
  }
  const diagnosticPath = testInfo.outputPath('conditional-apply-diagnostics.json')
  const writeResult = await evidence(() =>
    writeFile(diagnosticPath, `${JSON.stringify(diagnostic, null, 2)}\n`)
  )
  if (!writeResult.ok) {
    console.error(`Could not write conditional Apply diagnostics: ${writeResult.error}`)
    return
  }
  const attachResult = await evidence(() =>
    testInfo.attach('conditional-apply-diagnostics', {
      path: diagnosticPath,
      contentType: 'application/json'
    })
  )
  if (!attachResult.ok)
    console.error(`Could not attach conditional Apply diagnostics: ${attachResult.error}`)
}

for (const mutation of ['result', 'carried'] as const) {
  test(`conditional Apply refuses external ${mutation} mutation without touching original state`, async ({}, testInfo) => {
    const tool = process.env.GIT_CITY_REHEARSE_BIN!
    expect(tool).toBeTruthy()
    const root = await mkdtemp(join(tmpdir(), 'city-conditional-'))
    const profile = await mkdtemp(join(tmpdir(), 'city-conditional-profile-'))
    // Chromium recursively clears its sessionData/Cache directory at startup.
    const cache = await mkdtemp(join(tmpdir(), 'city-conditional-cache-'))
    const gitAt = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    const git = (...args: string[]): string => gitAt(root, ...args)
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgSign', 'false')
    await writeFile(join(root, 'file.txt'), 'base\n')
    await writeFile(join(root, 'local.txt'), 'base local\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-b', 'topic')
    await writeFile(join(root, 'file.txt'), 'topic\n')
    git('commit', '-am', 'topic')
    git('checkout', 'main')
    if (mutation === 'carried') {
      await writeFile(join(root, 'local.txt'), 'staged local\n')
      git('add', 'local.txt')
      await writeFile(join(root, 'local.txt'), 'unstaged local\n')
    }
    await writeFile(join(root, 'untracked.txt'), 'excluded sentinel\n')
    const snapshot = async () => ({
      head: git('rev-parse', 'HEAD'),
      refs: git('show-ref'),
      index: await readFile(join(root, '.git/index')),
      staged: git('ls-files', '--stage'),
      tracked: await readFile(join(root, 'file.txt')),
      local: await readFile(join(root, 'local.txt')),
      untracked: await readFile(join(root, 'untracked.txt')),
      recovery: await readFile(join(root, '.git/rehearse-apply')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        }
      )
    })
    const original = await snapshot()
    const app = await electron.launch({
      args: [resolve('out/main/index.js'), `--user-data-dir=${profile}`],
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: 'http://localhost:5199',
        GIT_CITY_REHEARSE_BIN: tool,
        GIT_REHEARSE_CACHE_DIR: cache
      }
    })
    let report: RehearsalReport | undefined
    let request: RehearsalApplyRequest | undefined
    let refsBeforeMutation: EvidenceResult<{ origin: string; sandbox: string }> | undefined
    let refsAfterMutation: EvidenceResult<{ origin: string; sandbox: string }> | undefined
    let chosenRef: string | undefined
    let changedOid: string | undefined
    let failed = false
    try {
      const page = await app.firstWindow()
      const sessionData = await app.evaluate(({ app }) => app.getPath('sessionData'))
      const [sessionDataPath, toolCachePath] = await Promise.all([
        realpath(sessionData),
        realpath(cache)
      ])
      expect(
        isWithin(sessionDataPath, toolCachePath),
        `Rehearsal cache ${toolCachePath} must be outside Electron sessionData ${sessionDataPath}`
      ).toBe(false)
      const result = await page.evaluate(
        (repo) => window.gitCity.rehearseMerge(repo, 'topic'),
        root
      )
      if (result.kind !== 'report') throw new Error(JSON.stringify(result))
      report = result.report
      request = await reviewedApplyRequest(page, result.report)
      // Rehearsing carried work can populate Git's index cache-tree extension.
      // Verify unchanged staged entries/files, then freeze exact bytes at the
      // review boundary whose later conditional Apply must have no effects.
      const reviewedOriginal = await snapshot()
      expect({ ...reviewedOriginal, index: original.index }).toEqual(original)
      const sandbox = result.report.sandbox!
      const carried = result.report.result_endpoints?.carried
      refsBeforeMutation = await evidence(() => ({
        origin: gitAt(root, 'for-each-ref', '--format=%(refname) %(objectname)'),
        sandbox: gitAt(sandbox, 'for-each-ref', '--format=%(refname) %(objectname)')
      }))
      // The mutator is a separate real Git process. Only published descriptors
      // identify the object; discover its actual ref for this adversarial test.
      // The application itself never guesses retained ref names.
      if (mutation === 'result') {
        const changed = gitAt(
          sandbox,
          'commit-tree',
          'HEAD^{tree}',
          '-p',
          'HEAD',
          '-m',
          'external changed result'
        )
        chosenRef = 'HEAD'
        changedOid = changed
        gitAt(sandbox, 'update-ref', 'HEAD', changed)
      } else {
        expect(carried?.replay_ref).toBeTruthy()
        expect(carried?.replay).toBeTruthy()
        const changed = gitAt(
          sandbox,
          'commit-tree',
          `${carried!.replay}^{tree}`,
          '-p',
          carried!.replay!,
          '-m',
          'external changed carried snapshot'
        )
        const replayRefs = gitAt(sandbox, 'for-each-ref', '--format=%(refname) %(objectname)')
          .split('\n')
          .filter((line) => line.endsWith(` ${carried!.replay_ref}`))
          .map((line) => line.split(' ')[0])
        expect(replayRefs).toHaveLength(1)
        chosenRef = replayRefs[0]
        changedOid = changed
        gitAt(sandbox, 'update-ref', replayRefs[0], changed)
      }
      refsAfterMutation = await evidence(() => ({
        origin: gitAt(root, 'for-each-ref', '--format=%(refname) %(objectname)'),
        sandbox: gitAt(sandbox, 'for-each-ref', '--format=%(refname) %(objectname)')
      }))
      const changed = await page.evaluate(
        (identity) => window.gitCity.rehearsalShow(identity),
        result.report
      )
      if (changed.kind !== 'report') throw new Error(JSON.stringify(changed))
      expect(changed.report.result_revision).not.toBe(request.expectedResultRevision)
      if (mutation === 'carried') expect(changed.report.carried).toEqual(result.report.carried)
      const refused = await page.evaluate(
        (confirmation) => window.gitCity.rehearsalApply(confirmation),
        request
      )
      expect(refused.kind, JSON.stringify(refused)).toBe('refused')
      expect(await snapshot()).toEqual(reviewedOriginal)
      const retained = await page.evaluate(
        (identity) => window.gitCity.rehearsalShow(identity),
        result.report
      )
      expect(retained.kind).toBe('report')
      expect(await readFile(join(root, 'untracked.txt'), 'utf8')).toBe('excluded sentinel\n')
    } catch (error) {
      failed = true
      const preserveResult = await evidence(() =>
        preserveFailureEvidence({
          testInfo,
          tool,
          root,
          cache,
          mutation,
          failure: error,
          report,
          request,
          refsBeforeMutation,
          refsAfterMutation,
          chosenRef,
          changedOid
        })
      )
      if (!preserveResult.ok)
        console.error(`Could not preserve conditional Apply evidence: ${preserveResult.error}`)
      throw error
    } finally {
      if (failed) {
        await evidence(() => app.close())
        await evidence(() => rm(root, { recursive: true, force: true }))
        await evidence(() => rm(profile, { recursive: true, force: true }))
        await evidence(() => rm(cache, { recursive: true, force: true }))
      } else {
        await app.close()
        await rm(root, { recursive: true, force: true })
        await rm(profile, { recursive: true, force: true })
        await rm(cache, { recursive: true, force: true })
      }
    }
  })
}
