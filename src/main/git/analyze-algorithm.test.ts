import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { makeTempRepo } from './fixtures'

const cleanup: string[] = []
const originalGlobalConfig = process.env.GIT_CONFIG_GLOBAL

function makeAlgorithmFixture(): string {
  const repo = makeTempRepo('git-city-diff-algorithm-')
  cleanup.push(repo.path)
  const before = [
    'item 0',
    'item 0',
    'item 5',
    'item 2',
    'item 6',
    'item 0',
    'item 1',
    'item 3',
    'item 5',
    'item 4',
    'item 5',
    'item 0',
    'item 1',
    'item 7',
    'item 3',
    'item 2',
    'item 1',
    'item 2',
    'item 4',
    'item 6',
    'item 2',
    'item 5',
    'item 5',
    'item 5',
    'item 4',
    'item 6',
    'item 2',
    'item 2',
    'item 3',
    'item 3'
  ]
  const after = [
    'item 3',
    'item 0',
    'item 6',
    'item 2',
    'item 6',
    'item 0',
    'item 1',
    'item 3',
    'item 5',
    'item 4',
    'item 5',
    'item 0',
    'item 2',
    'item 4',
    'item 6',
    'item 2',
    'item 5',
    'item 5',
    'item 5',
    'item 4',
    'item 2',
    'item 2',
    'item 2',
    'item 3',
    'item 3',
    'item 1',
    'item 7',
    'item 3',
    'item 2',
    'item 1'
  ]
  repo.write('items.txt', `${before.join('\n')}\n`)
  repo.commitAll('initial')
  repo.write('items.txt', `${after.join('\n')}\n`)
  repo.commitAll('rearrange items')
  return repo.path
}

async function analyzeWithGlobalConfig(repoPath: string, globalConfig: string) {
  vi.resetModules()
  process.env.GIT_CONFIG_GLOBAL = globalConfig
  const { analyzeRepo } = await import('./analyze')
  return analyzeRepo(repoPath, 50, () => {})
}

afterAll(() => {
  if (originalGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = originalGlobalConfig
  for (const path of cleanup) rmSync(path, { recursive: true, force: true })
})

describe('analyzeRepo diff algorithm', () => {
  it('returns the same analysis when global config selects histogram', async () => {
    const repoPath = makeAlgorithmFixture()
    const configDir = mkdtempSync(join(tmpdir(), 'git-city-global-config-'))
    cleanup.push(configDir)
    const defaultConfig = join(configDir, 'default')
    const histogramConfig = join(configDir, 'histogram')
    writeFileSync(defaultConfig, '')
    writeFileSync(histogramConfig, '[diff]\n\talgorithm = histogram\n')

    const myers = execFileSync(
      'git',
      ['-c', 'diff.algorithm=myers', 'show', '--numstat', '--format=', 'HEAD'],
      {
        cwd: repoPath,
        encoding: 'utf8'
      }
    )
    const histogram = execFileSync(
      'git',
      ['-c', 'diff.algorithm=histogram', 'show', '--numstat', '--format=', 'HEAD'],
      { cwd: repoPath, encoding: 'utf8' }
    )
    expect(histogram).not.toBe(myers)

    const defaultAnalysis = await analyzeWithGlobalConfig(repoPath, defaultConfig)
    const histogramAnalysis = await analyzeWithGlobalConfig(repoPath, histogramConfig)

    expect(histogramAnalysis).toEqual(defaultAnalysis)
  })
})
