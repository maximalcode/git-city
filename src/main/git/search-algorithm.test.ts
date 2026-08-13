import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { CommitDetail } from '../../shared/types'
import { makeTempRepo } from './fixtures'

const cleanup: string[] = []
const originalGlobalConfig = process.env.GIT_CONFIG_GLOBAL

function makeAlgorithmFixture(): string {
  const repo = makeTempRepo('git-city-detail-algorithm-')
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

/**
 * exec.ts snapshots process.env into GIT_ENV at module load, so the global
 * config has to be set before a fresh import of the module under test.
 */
async function detailWithGlobalConfig(repoPath: string, globalConfig: string): Promise<CommitDetail> {
  vi.resetModules()
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  const { commitDetail } = await import('./search')
  return commitDetail(repoPath, 'HEAD')
}

afterAll(() => {
  if (originalGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = originalGlobalConfig
  for (const path of cleanup) rmSync(path, { recursive: true, force: true })
})

describe('commitDetail diff algorithm', () => {
  it('returns the pinned Myers counts when global config selects histogram', async () => {
    const repoPath = makeAlgorithmFixture()
    const configDir = mkdtempSync(join(tmpdir(), 'git-city-global-config-'))
    cleanup.push(configDir)
    const histogramConfig = join(configDir, 'histogram')
    writeFileSync(histogramConfig, '[diff]\n\talgorithm = histogram\n')

    // The same line multiset is permuted, but the algorithms count its churn differently.
    const myers = numstatWith(repoPath, 'myers')
    expect(numstatWith(repoPath, 'histogram')).not.toBe(myers)
    const [myersAdd, myersDel] = myers.trim().split('\t').map(Number)

    const detail = await detailWithGlobalConfig(repoPath, histogramConfig)

    expect(detail.files).toEqual([
      { path: 'items.txt', additions: myersAdd, deletions: myersDel, binary: false }
    ])
  })
})
