import { defineConfig } from 'vitest/config'

/**
 * The git-op suites spawn hundreds of real git processes; running many test
 * files in parallel on Windows (with Defender scanning every temp repo) makes
 * individual commands crawl past vitest's 5s default. Longer timeout + capped
 * workers keeps the suite deterministic.
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'threads',
    poolOptions: { threads: { maxThreads: 2, minThreads: 1 } }
  }
})
