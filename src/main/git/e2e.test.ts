import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { analyzeRepo } from './analyze'
import { cloneRepo } from './clone'

/**
 * Network end-to-end test: clones a real public GitHub repo and analyzes it.
 * Skipped unless GITCITY_E2E=1 so the normal suite stays offline and fast.
 */
const enabled = process.env.GITCITY_E2E === '1'
const base = join(tmpdir(), 'git-city-e2e')

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

describe.skipIf(!enabled)('clone + analyze a real GitHub repo', () => {
  it(
    'clones expressjs/express and replays its history',
    async () => {
      const path = await cloneRepo('https://github.com/expressjs/express', base, () => {})
      expect(path).toMatch(/express$/)

      const progress: number[] = []
      const result = await analyzeRepo(path, 50, (p) => {
        if (p.phase === 'reading-history') progress.push(p.done)
      })

      expect(result.info.name).toBe('express')
      expect(result.info.commitCount).toBeGreaterThan(3000)
      expect(result.snapshots.length).toBeGreaterThanOrEqual(50)

      const head = result.snapshots[result.snapshots.length - 1]
      const paths = new Set(head.files.map((f) => f.path))
      expect(paths.has('package.json')).toBe(true)
      expect(paths.has('lib/express.js')).toBe(true)

      // sanity: line counts are plausible and cumulative commits grow over time
      const pkg = head.files.find((f) => f.path === 'package.json')!
      expect(pkg.loc).toBeGreaterThan(30)
      expect(pkg.commits).toBeGreaterThan(100)
      const first = result.snapshots[0]
      expect(first.files.length).toBeLessThan(head.files.length)
    },
    240_000
  )
})
