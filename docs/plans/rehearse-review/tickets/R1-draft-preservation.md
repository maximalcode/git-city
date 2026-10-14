# R1 — Preserve conflict drafts across navigation and restart

Published issue: [maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193)

## Parent

https://github.com/maximalcode/git-city/issues/195; reuse existing #193. Status: approved; ready-for-agent subject to declared blockers.

## What to build

Keep a user's uncommitted conflict-editing decisions and text safe while navigating files, rehearsals and worktrees, closing the panel or restarting the app. Draft persistence is distinct from explicit Save and stage in sandbox.

## Acceptance criteria

- [ ] Drafts are owned by canonical original worktree, full rehearsal identity and path; base revision is retained inside the record.
- [ ] Two independent edited files survive navigation, switching rehearsal/worktree, close/reopen and restart. Edits are never copied into another identity.
- [ ] Choices, whole-file/hunk text and editing mode round-trip through versioned, atomic local persistence. Pending/saved/failure status is truthful.
- [ ] Orderly close/quit waits for pending persistence or obtains an explicit abandon decision on failure. Restart restores the last acknowledged durable draft; no promise covers unflushed crash-time keystrokes.
- [ ] Refresh, external revision change and focus return preserve the old draft/base separately from current sandbox content. An obsolete draft cannot be saved against the new revision without deliberate reconciliation or discard/reload.
- [ ] Save success clears only the exact saved draft. Save/stage failure and partial write/stage completion preserve text, explain actual state and avoid blind retry.
- [ ] Keep retains drafts; confirmed successful Discard removes only that rehearsal's drafts afterward. Failed discard, recovery data and unrelated rehearsals remain untouched.
- [ ] Continue/Apply cannot silently abandon dirty drafts; an actionable decision protects them. Existing backend revision/isolation checks remain mandatory.
- [ ] A real Electron regression demonstrates the #193 reproduction is fixed and restart/external-change behavior works; original HEAD, index and contents stay unchanged before explicit Apply.
- [ ] User guide describes draft persistence, sandbox save/stage and failure recovery in the same PR.

## Blocked by

None — can start immediately. Shared bridge names and draft lifecycle are pinned in the runbook. R5 adds explicit conflict acknowledgement rules later; R1 preserves existing choices without treating a default as a new user decision.

## Owned behavior and validation

Own local draft lifecycle/storage and its editor wiring. Reuse the existing rehearsal identity, conflict read/save revision and query seams. Test via public bridge and visible interactions, including malformed/incompatible storage, failed persistence and late saves. Required checks follow the runbook plus draft-focused Electron acceptance.
