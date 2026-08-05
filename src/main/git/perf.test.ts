import { describe, expect, it } from 'vitest'
import { analyzeRepo } from './analyze'
import { analysisBytes } from '../../shared/snapshots'

/**
 * Performance probe against a real repository, so the README can state an
 * honest ceiling instead of letting strangers discover it on a monorepo.
 *
 * Off by default — point it at a checkout to run it:
 *   GITCITY_PERF=/path/to/big-repo npx vitest run src/main/git/perf.test.ts
 *
 * It asserts almost nothing. The numbers it prints are the deliverable; the
 * only failure condition is not finishing at all.
 */
const repoPath = process.env.GITCITY_PERF
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

describe.skipIf(!repoPath)('analysis performance', () => {
  it(
    'replays a large repository',
    async () => {
      const before = process.memoryUsage().heapUsed
      const started = Date.now()
      let lastPhase = ''
      const phaseAt: Record<string, number> = {}

      const result = await analyzeRepo(repoPath!, 50, (p) => {
        if (p.phase !== lastPhase) {
          lastPhase = p.phase
          phaseAt[p.phase] = Date.now() - started
        }
      })

      const elapsed = Date.now() - started
      const heap = process.memoryUsage().heapUsed - before
      const head = result.snapshots.at(-1)

      console.log('\n--- git-city analysis probe ---')
      console.log(`repo            ${repoPath}`)
      console.log(`commits         ${result.info.commitCount.toLocaleString()}`)
      console.log(`files at HEAD   ${head?.pathId.length.toLocaleString() ?? 0}`)
      console.log(`snapshots       ${result.snapshots.length}`)
      console.log(`total time      ${secs(elapsed)}`)
      for (const [phase, at] of Object.entries(phaseAt)) {
        console.log(`  ${phase.padEnd(14)}started at ${secs(at)}`)
      }
      console.log(`heap growth     ${mb(heap)}`)
      console.log(`peak rss        ${mb(process.memoryUsage().rss)}`)
      // What the analysis keeps, as opposed to what the replay transiently
      // used — the retained number is what #62 is accountable to.
      console.log(`analysis kept   ${mb(analysisBytes(result))}`)
      console.log('-------------------------------\n')

      expect(result.snapshots.length).toBeGreaterThan(0)
      expect(head?.pathId.length).toBeGreaterThan(0)
    },
    30 * 60 * 1000
  )
})
