import { beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { spawn } from 'child_process'
import { rehearse, rehearseMerge, rehearsalAvailability } from './rehearsal'

vi.mock('child_process', () => ({ spawn: vi.fn() }))
const replies: { code: number; stdout: string }[] = []
beforeEach(() => {
  replies.length = 0
  vi.mocked(spawn)
    .mockReset()
    .mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn()
      })
      const reply = replies.shift()!
      queueMicrotask(() => {
        child.stdout.end(reply.stdout)
        child.emit('close', reply.code)
      })
      return child as unknown as ReturnType<typeof spawn>
    })
})

it('blocks an incompatible executable before a merge is started', async () => {
  replies.push({ code: 0, stdout: 'git-rehearse 9.0.0' })
  expect((await rehearsalAvailability('/configured/tool')).available).toBe(false)
  expect(spawn).toHaveBeenCalledTimes(1)
})

it.each([
  [{ schema: 1, kind: 'refused', message: 'Shallow repository', exit_code: 3 }, 'refused'],
  [{ schema: 1, kind: 'internal', message: 'Disk unavailable', exit_code: 4 }, 'error'],
  [{ schema: 2, id: 'unknown' }, 'error'],
  [{ schema: 1, outcome: 'clean' }, 'error']
])('classifies CLI documents without falling back to git (%j)', async (document, kind) => {
  replies.push(
    { code: 0, stdout: 'git-rehearse 1.2.0' },
    { code: 3, stdout: JSON.stringify(document) }
  )
  const result = await rehearseMerge('/configured/tool', process.cwd(), 'topic with spaces')
  expect(result.kind).toBe(kind)
  expect(spawn).toHaveBeenCalledTimes(2)
  expect(vi.mocked(spawn).mock.calls[1][1]).toEqual([
    '--json',
    '--keep',
    'merge',
    'topic with spaces'
  ])
})

it.each(['topic', 'a..b', '--continue', 'a'.repeat(40) + '^!'])(
  'refuses non-single-commit cherry-pick input %s before execution',
  async (target) => {
    expect((await rehearse('/configured/tool', process.cwd(), 'cherry-pick', target)).kind).toBe(
      'refused'
    )
    expect(spawn).not.toHaveBeenCalled()
  }
)

it.each([
  { base: null, entries: [] },
  {
    base: null,
    entries: [
      { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'drop', action: 'drop' as const }
    ]
  },
  {
    base: 'main',
    entries: [
      { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'pick', action: 'pick' as const }
    ]
  },
  {
    base: null,
    entries: [
      { hash: 'HEAD\nexec unsafe', shortHash: 'HEAD', subject: 'pick', action: 'pick' as const }
    ]
  }
])('refuses an invalid interactive plan before starting the tool (%j)', async (plan) => {
  expect((await rehearse('/configured/tool', process.cwd(), 'rebase', 'root', plan)).kind).toBe(
    'refused'
  )
  expect(spawn).not.toHaveBeenCalled()
})
