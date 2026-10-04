import { expect, it } from 'vitest'
import type { RebaseEntry } from './types'
import { prepareRebasePlan } from './rebasePlan'

const entry = (digit: string, action: RebaseEntry['action'] = 'pick'): RebaseEntry => ({
  hash: digit.repeat(40),
  shortHash: digit.repeat(7),
  subject: `commit ${digit}`,
  action
})

it('preserves the reordered pick/squash/drop plan in Git execution order', () => {
  const entries = [entry('3', 'squash'), entry('1'), entry('2'), entry('4', 'drop')]
  const original = structuredClone(entries)
  expect(prepareRebasePlan({ base: '0'.repeat(40), entries })).toEqual({
    ok: true,
    todo: `drop ${'4'.repeat(40)}\npick ${'2'.repeat(40)}\npick ${'1'.repeat(40)}\nsquash ${'3'.repeat(40)}\n`,
    command: ['rebase', '-i', '0'.repeat(40)]
  })
  expect(entries).toEqual(original)
})

it('promotes only the oldest squash to pick and supports the root without an editor', () => {
  const entries = [entry('2', 'squash'), entry('1', 'squash')]
  expect(prepareRebasePlan({ base: null, entries })).toEqual({
    ok: true,
    todo: `pick ${'1'.repeat(40)}\nsquash ${'2'.repeat(40)}\n`,
    command: ['rebase', '-i', '--root']
  })
  expect(entries[1].action).toBe('squash')
})

it.each([
  { base: null, entries: [] },
  { base: null, entries: [entry('1', 'drop')] },
  { base: 'HEAD', entries: [entry('1')] },
  { base: null, entries: [entry('1'), entry('1')] },
  { base: null, entries: [{ ...entry('1'), hash: 'HEAD\nexec unsafe' }] }
])('refuses a plan that cannot be safely prepared (%j)', (plan) => {
  expect(prepareRebasePlan(plan).ok).toBe(false)
})
