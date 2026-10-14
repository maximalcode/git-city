import { expect, it } from 'vitest'
import type { ConflictSegment, RehearsalDraftPayload } from '../../../shared/types'
import { rehearsalResolutionReadiness, WHOLE_FILE_DECISION } from './rehearsalConflictDecisions'

const hunks: ConflictSegment[] = [0, 1].map((id) => ({
  kind: 'conflict',
  id,
  ours: `destination ${id}\n`,
  theirs: `replayed ${id}\n`,
  oursLabel: 'HEAD',
  theirsLabel: 'topic'
}))
const draft: RehearsalDraftPayload = {
  base_revision: 'current',
  base_content: '',
  mode: 'hunks',
  whole_file_text: null,
  choices: {},
  edits: {},
  acknowledged_hunks: []
}

it('requires a deliberate decision for every hunk instead of accepting the default preview', () => {
  expect(rehearsalResolutionReadiness(hunks, draft, 'current').unreviewed).toEqual([0, 1])
  const one = { ...draft, choices: { '0': 'ours' as const }, acknowledged_hunks: ['0'] }
  expect(rehearsalResolutionReadiness(hunks, one, 'current')).toMatchObject({
    eligible: false,
    unreviewed: [1]
  })
  const both = {
    ...one,
    choices: { ...one.choices, '1': 'theirs' as const },
    acknowledged_hunks: ['0', '1']
  }
  expect(rehearsalResolutionReadiness(hunks, both, 'current').eligible).toBe(true)
  expect(rehearsalResolutionReadiness(hunks, both, 'changed').eligible).toBe(false)
})

it('requires a whole-file decision separately from old hunk choices', () => {
  const whole: RehearsalDraftPayload = {
    ...draft,
    mode: 'whole-file',
    whole_file_text: 'deliberate result\n',
    acknowledged_hunks: ['0', '1']
  }
  expect(rehearsalResolutionReadiness(hunks, whole, 'current').eligible).toBe(false)
  const confirmed = { ...whole, acknowledged_hunks: [WHOLE_FILE_DECISION] }
  expect(rehearsalResolutionReadiness(hunks, confirmed, 'current').eligible).toBe(true)
  expect(rehearsalResolutionReadiness(hunks, confirmed, 'changed').eligible).toBe(false)
  expect(rehearsalResolutionReadiness([], draft, 'current').eligible).toBe(false)
})
