import { describe, it, expect } from 'vitest'
import { countDiffLines, deriveCi, mapMr, parseMrChanges, parseMrList } from './gitlab'

describe('deriveCi', () => {
  it('returns none when there is no pipeline at all', () => {
    expect(deriveCi(null)).toBe('none')
    expect(deriveCi(undefined)).toBe('none')
    expect(deriveCi({})).toBe('none')
  })

  it('maps success to passing', () => {
    expect(deriveCi({ status: 'success' })).toBe('passing')
  })

  it('maps failure and cancellation to failing', () => {
    expect(deriveCi({ status: 'failed' })).toBe('failing')
    expect(deriveCi({ status: 'canceled' })).toBe('failing')
    expect(deriveCi({ status: 'cancelled' })).toBe('failing')
  })

  it('maps every in-flight status to pending', () => {
    for (const status of [
      'created',
      'waiting_for_resource',
      'preparing',
      'pending',
      'running',
      'scheduled'
    ]) {
      expect(deriveCi({ status })).toBe('pending')
    }
  })

  it('treats a manual gate as pending, not a failure', () => {
    expect(deriveCi({ status: 'manual' })).toBe('pending')
  })

  it('treats a skipped pipeline as no checks', () => {
    expect(deriveCi({ status: 'skipped' })).toBe('none')
  })

  it('treats an unrecognised status as pending rather than claiming success', () => {
    expect(deriveCi({ status: 'something_new' })).toBe('pending')
  })
})

describe('mapMr', () => {
  const mr = {
    iid: 7,
    title: 'Add the thing',
    source_branch: 'feat/thing',
    target_branch: 'main',
    state: 'opened',
    draft: false,
    web_url: 'https://gitlab.com/g/r/-/merge_requests/7',
    author: { username: 'ada' },
    head_pipeline: { status: 'success' }
  }

  it('maps a merge request onto the shared PR model', () => {
    expect(mapMr(mr)).toEqual({
      number: 7,
      title: 'Add the thing',
      headRef: 'feat/thing',
      baseRef: 'main',
      state: 'OPEN',
      isDraft: false,
      url: 'https://gitlab.com/g/r/-/merge_requests/7',
      author: 'ada',
      ci: 'passing'
    })
  })

  it('normalises opened to OPEN and uppercases other states', () => {
    expect(mapMr({ ...mr, state: 'opened' }).state).toBe('OPEN')
    expect(mapMr({ ...mr, state: 'merged' }).state).toBe('MERGED')
    expect(mapMr({ ...mr, state: 'closed' }).state).toBe('CLOSED')
  })

  it('honours the legacy work_in_progress flag as draft', () => {
    expect(mapMr({ ...mr, draft: undefined, work_in_progress: true }).isDraft).toBe(true)
  })

  it('falls back to the older pipeline field when head_pipeline is absent', () => {
    const { head_pipeline: _omit, ...rest } = mr
    expect(mapMr({ ...rest, pipeline: { status: 'running' } }).ci).toBe('pending')
  })

  it('survives a payload with everything missing', () => {
    expect(mapMr({})).toEqual({
      number: 0,
      title: '',
      headRef: '',
      baseRef: '',
      state: 'OPEN',
      isDraft: false,
      url: '',
      author: '',
      ci: 'none'
    })
  })
})

describe('parseMrList', () => {
  it('maps an array and drops entries without an iid', () => {
    const json = JSON.stringify([{ iid: 1, title: 'a' }, { title: 'no iid' }])
    const list = parseMrList(json)
    expect(list).toHaveLength(1)
    expect(list[0].number).toBe(1)
  })

  it('returns [] for malformed or non-array payloads', () => {
    expect(parseMrList('not json')).toEqual([])
    expect(parseMrList('{"message":"404 Not found"}')).toEqual([])
    expect(parseMrList('[]')).toEqual([])
  })
})

describe('countDiffLines', () => {
  it('counts added and removed lines, ignoring the file headers', () => {
    const diff = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,3 @@',
      ' same',
      '-gone',
      '+new',
      '+also'
    ].join('\n')
    expect(countDiffLines(diff)).toEqual({ additions: 2, deletions: 1 })
  })

  it('counts content lines that begin with -- or ++', () => {
    // a removed `-- comment` renders as `---` + the text, which a bare
    // startsWith('---') would mistake for a file header and drop
    const diff = ['@@ -1,2 +1,2 @@', '--- sql comment', '+++value', ' same'].join('\n')
    expect(countDiffLines(diff)).toEqual({ additions: 1, deletions: 1 })
  })

  it('handles an empty diff', () => {
    expect(countDiffLines('')).toEqual({ additions: 0, deletions: 0 })
  })

  it('counts a pure addition', () => {
    expect(countDiffLines('+++ b/new.ts\n+one\n+two')).toEqual({ additions: 2, deletions: 0 })
  })
})

describe('parseMrChanges', () => {
  it('derives per-file counts from the diffs GitLab ships', () => {
    const json = JSON.stringify({
      changes: [
        { new_path: 'src/a.ts', old_path: 'src/a.ts', diff: '@@\n+one\n+two\n-old\n' },
        { new_path: 'README.md', old_path: 'README.md', diff: '@@\n+hello\n' }
      ]
    })
    expect(parseMrChanges(json)).toEqual([
      { path: 'src/a.ts', additions: 2, deletions: 1 },
      { path: 'README.md', additions: 1, deletions: 0 }
    ])
  })

  it('falls back to old_path for a deleted file and drops pathless entries', () => {
    const json = JSON.stringify({
      changes: [{ old_path: 'gone.ts', diff: '-a\n-b\n' }, { diff: '+x' }]
    })
    expect(parseMrChanges(json)).toEqual([{ path: 'gone.ts', additions: 0, deletions: 2 }])
  })

  it('returns [] for malformed or empty input', () => {
    expect(parseMrChanges('not json')).toEqual([])
    expect(parseMrChanges('{}')).toEqual([])
    expect(parseMrChanges(JSON.stringify({ changes: null }))).toEqual([])
  })
})
