import { rmSync } from 'fs'
import { afterAll, describe, expect, it } from 'vitest'
import type { RepoChangeReason } from '../../shared/types'
import { makeTempRepo } from './fixtures'
import { RepoWatcher } from './watcher'

const cleanups: string[] = []
afterAll(() => {
  for (const p of cleanups) rmSync(p, { recursive: true, force: true })
})

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true
    await wait(50)
  }
  return cond()
}

describe('RepoWatcher', () => {
  it('emits debounced worktree events and stays silent while muted', async () => {
    const r = makeTempRepo()
    cleanups.push(r.path)
    r.write('a.txt', 'one\n')
    r.commitAll('initial')

    const events: RepoChangeReason[][] = []
    const w = new RepoWatcher()
    await w.start(r.path, (reasons) => events.push(reasons))
    await wait(200) // let fs.watch settle

    r.write('a.txt', 'changed\n')
    expect(await until(() => events.length >= 1)).toBe(true)
    expect(events.some((e) => e.includes('worktree'))).toBe(true)

    // muted: writes must not emit; unmute emits exactly one synthetic event
    const before = events.length
    w.mute()
    r.write('a.txt', 'muted change 1\n')
    r.write('b.txt', 'muted change 2\n')
    await wait(600) // > debounce window
    expect(events.length).toBe(before)

    w.unmute()
    expect(await until(() => events.length === before + 1)).toBe(true)
    await wait(600)
    expect(events.length).toBe(before + 1)

    w.stop()
  }, 15_000)

  it('classifies commits as head/index/refs changes', async () => {
    const r = makeTempRepo()
    cleanups.push(r.path)
    r.write('a.txt', 'one\n')
    r.commitAll('initial')

    const seen = new Set<RepoChangeReason>()
    const w = new RepoWatcher()
    await w.start(r.path, (reasons) => reasons.forEach((x) => seen.add(x)))
    await wait(200)

    r.write('a.txt', 'two\n')
    r.commitAll('second') // touches index + refs (+ possibly HEAD)

    expect(await until(() => seen.has('index') || seen.has('refs'))).toBe(true)
    w.stop()
  }, 15_000)
})
