import { describe, expect, it } from 'vitest'
import { classifyGitError, failFrom, failFromError, ok, optionLikeName } from './result'

describe('classifyGitError', () => {
  const cases: [string, string][] = [
    ['fatal: could not read Username for https://github.com', 'auth'],
    ['terminal prompts disabled', 'auth'],
    ['remote: HTTP 401', 'auth'],
    ['The requested URL returned error: status code: 403', 'auth'],
    ['Permission denied (publickey).', 'auth'],
    ['! [rejected] main -> main (non-fast-forward)', 'rejected'],
    ['error: failed to push some refs', 'rejected'],
    ['hint: fetch first', 'rejected'],
    ['fatal: The current branch feat has no upstream branch.', 'no-upstream'],
    ['There is no tracking information for the current branch.', 'no-upstream'],
    ['CONFLICT (content): Merge conflict in a.txt', 'conflict'],
    ['error: could not apply abc123... subject', 'conflict'],
    ['fatal: You have unmerged paths.', 'conflict'],
    ['error: Your local changes to the following files would be overwritten by checkout', 'dirty'],
    ['Please commit your changes or stash them before you merge.', 'dirty'],
    ['cannot rebase: You have unstaged changes.', 'dirty'],
    ["error: the branch 'feat' is not fully merged", 'not-merged'],
    ['nothing to commit, working tree clean', 'nothing-to-do'],
    ['No local changes to save', 'nothing-to-do'],
    ['Already up to date.', 'nothing-to-do'],
    ['fatal: something completely unexpected', 'unknown'],
    ['', 'unknown']
  ]

  it.each(cases)('classifies %j as %s', (text, code) => {
    expect(classifyGitError(text)).toBe(code)
  })
})

describe('failFrom / failFromError / ok', () => {
  it('builds a failure with the first meaningful line as message', () => {
    const res = failFrom({ code: 1, stdout: '', stderr: 'error: bad thing\nmore detail' })
    expect(res.ok).toBe(false)
    expect(res.message).toBe('bad thing')
    expect(res.gitOutput).toContain('more detail')
  })

  it('strips error/fatal/warning prefixes from the message', () => {
    expect(failFrom({ code: 128, stdout: '', stderr: 'fatal: not a git repository' }).message).toBe(
      'not a git repository'
    )
  })

  it('classifies thrown errors too', () => {
    const res = failFromError(new Error('CONFLICT (content): Merge conflict in x'))
    expect(res.code).toBe('conflict')
  })

  it('ok() carries an optional message', () => {
    expect(ok()).toEqual({ ok: true, message: undefined })
    expect(ok('done').message).toBe('done')
  })
})

describe('optionLikeName', () => {
  it('rejects names that would parse as git options', () => {
    expect(optionLikeName('-d')?.ok).toBe(false)
    expect(optionLikeName('--delete')?.ok).toBe(false)
    expect(optionLikeName('-')?.ok).toBe(false)
  })

  it('accepts normal names', () => {
    expect(optionLikeName('v1.0')).toBeNull()
    expect(optionLikeName('feature/x-y')).toBeNull()
    expect(optionLikeName('weird-but-fine')).toBeNull()
  })
})
