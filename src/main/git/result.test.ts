import { describe, expect, it } from 'vitest'
import {
  classifyGitError,
  failFrom,
  failFromError,
  nothingToDo,
  ok,
  optionLikeName,
  stripNoise
} from './result'

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
    // a first commit on a machine git has never been configured on (#26)
    ['Author identity unknown\n\n*** Please tell me who you are.', 'identity'],
    ['fatal: empty ident name (for <you@your-host.local>) not allowed', 'identity'],
    ['fatal: unable to auto-detect email address', 'identity'],
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

  /**
   * git leads a rejected push with "To <url>", which reads like a success line
   * and was the entire toast — while the sentence explaining what to do sat
   * inside a collapsed expander (#26).
   */
  it('skips transport chatter when picking the headline', () => {
    const push = failFrom({
      code: 1,
      stdout: '',
      stderr:
        'To github.com:you/your-repo.git\n' +
        ' ! [rejected]        main -> main (fetch first)\n' +
        "hint: Updates were rejected because the remote contains work that you do\nhint: not have locally. Use 'git pull' before pushing again."
    })
    expect(push.message).toContain('[rejected]')
    expect(push.message).not.toMatch(/^To /)
    expect(push.code).toBe('rejected')
  })

  it('falls back to the transport line when it is genuinely all there is', () => {
    expect(failFrom({ code: 1, stdout: '', stderr: 'To github.com:you/repo.git' }).message).toBe(
      'To github.com:you/repo.git'
    )
  })

  it('marks a caller-supplied message as friendly, and a derived one as not', () => {
    // the flag is what stops the generic per-code wording replacing it
    expect(failFrom({ code: 1, stdout: '', stderr: 'x' }, 'Nothing to undo.').friendly).toBe(true)
    expect(failFrom({ code: 1, stdout: '', stderr: 'x' }).friendly).toBe(false)
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

describe('nothingToDo', () => {
  it('builds the failure the eight hand-written literals used to spell out', () => {
    expect(nothingToDo('Commit message is empty.')).toEqual({
      ok: false,
      code: 'nothing-to-do',
      message: 'Commit message is empty.'
    })
  })
})

describe('stripNoise', () => {
  it('strips severity prefixes and drops empty lines', () => {
    expect(stripNoise('fatal: not a repo\n\n  \nerror: bad thing\nwarning: heed\n')).toEqual([
      'not a repo',
      'bad thing',
      'heed'
    ])
  })

  it('leaves ordinary lines untouched', () => {
    expect(stripNoise('To github.com:you/repo.git\n ! [rejected] main -> main')).toEqual([
      'To github.com:you/repo.git',
      '! [rejected] main -> main'
    ])
  })

  it('returns an empty array for empty output', () => {
    expect(stripNoise('')).toEqual([])
  })
})
