import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGit, runGitLines, runGitResult } = vi.hoisted(() => ({
  runGit: vi.fn(),
  runGitLines: vi.fn(),
  runGitResult: vi.fn()
}))

vi.mock('./exec', () => ({ runGit, runGitLines, runGitResult }))

import { analyzeRepo } from './analyze'

describe('analyzeRepo git invocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runGitResult.mockResolvedValue({ code: 0, stdout: 'true\n', stderr: '' })
    runGit.mockImplementation(async (_repoPath: string, args: string[]) => {
      if (args[0] === 'rev-list') return '1\n'
      if (args.includes('--abbrev-ref')) return 'main\n'
      return ''
    })
    runGitLines.mockImplementation(async (_repoPath: string, _args: string[], onLine) => {
      onLine('\x01hash\t1\tTest\tinitial')
    })
  })

  it('pins Myers even when the user configures a different diff algorithm', async () => {
    await analyzeRepo('/fixture', 50, () => {})

    expect(runGitLines).toHaveBeenCalledWith(
      '/fixture',
      expect.arrayContaining(['-c', 'diff.algorithm=myers']),
      expect.any(Function)
    )
  })
})
