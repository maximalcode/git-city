import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { makeTempRepo } from './fixtures'

interface NumstatTotals {
  additions: number
  deletions: number
}

const cleanup: string[] = []
const originalGlobalConfig = process.env.GIT_CONFIG_GLOBAL

function makeAlgorithmFixture(): string {
  const repo = makeTempRepo('git-city-diff-algorithm-')
  cleanup.push(repo.path)
  const before = Array.from({ length: 24 }, (_, i) => `item ${i % 8}`)
  const permutation = [
    18, 4, 13, 3, 6, 1, 17, 8, 20, 15, 23, 2, 7, 12, 16, 0, 19, 14, 9, 5, 10, 22, 21, 11
  ]
  const after = permutation.map((i) => before[i])
  repo.write('items.txt', `${before.join('\n')}\n`)
  repo.commitAll('initial')
  repo.write('items.txt', `${after.join('\n')}\n`)
  repo.commitAll('rearrange items')
  return repo.path
}

function numstatWith(repoPath: string, algorithm: string): string {
  return execFileSync(
    'git',
    ['-c', `diff.algorithm=${algorithm}`, 'show', '--numstat', '--format=', 'HEAD'],
    { cwd: repoPath, encoding: 'utf8' }
  )
}

function countNumstat(line: string, totals: NumstatTotals): void {
  const [additions, deletions] = line.split('\t')
  if (!/^\d+$/.test(additions) || !/^\d+$/.test(deletions)) return
  totals.additions += Number(additions)
  totals.deletions += Number(deletions)
}

async function consumedNumstatWithGlobalConfig(
  repoPath: string,
  globalConfig: string
): Promise<NumstatTotals> {
  vi.resetModules()
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  const totals = { additions: 0, deletions: 0 }
  vi.doMock('./exec', async () => {
    const actual = await vi.importActual<typeof import('./exec')>('./exec')
    return {
      ...actual,
      runGitLines: async (
        cwd: string,
        args: string[],
        onLine: (line: string) => void
      ): Promise<void> =>
        actual.runGitLines(cwd, args, (line) => {
          countNumstat(line, totals)
          onLine(line)
        })
    }
  })
  try {
    const { analyzeRepo } = await import('./analyze')
    await analyzeRepo(repoPath, 50, () => {})
    return totals
  } finally {
    vi.doUnmock('./exec')
  }
}

afterAll(() => {
  if (originalGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = originalGlobalConfig
  for (const path of cleanup) rmSync(path, { recursive: true, force: true })
})

describe('analyzeRepo diff algorithm', () => {
  it('consumes the same numstat totals when global config selects histogram', async () => {
    const repoPath = makeAlgorithmFixture()
    const configDir = mkdtempSync(join(tmpdir(), 'git-city-global-config-'))
    cleanup.push(configDir)
    const defaultConfig = join(configDir, 'default')
    const histogramConfig = join(configDir, 'histogram')
    writeFileSync(defaultConfig, '')
    writeFileSync(histogramConfig, '[diff]\n\talgorithm = histogram\n')

    // The same line multiset is permuted, but the algorithms count its churn differently.
    expect(numstatWith(repoPath, 'histogram')).not.toBe(numstatWith(repoPath, 'myers'))

    const defaultTotals = await consumedNumstatWithGlobalConfig(repoPath, defaultConfig)
    const histogramTotals = await consumedNumstatWithGlobalConfig(repoPath, histogramConfig)

    expect(histogramTotals).toEqual(defaultTotals)
  })
})
