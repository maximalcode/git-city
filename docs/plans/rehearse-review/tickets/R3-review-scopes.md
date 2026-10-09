# R3 — Review every affected scope and non-text change honestly

## Parent

Git City #195; source finding #191. Status: draft awaiting approval.

## What to build

Extend the usable frozen review to multiple affected references and special file changes without blending branch results, hiding entries or inventing content.

## Acceptance criteria

- [ ] The default tracked-worktree scope is distinct from each affected reference's committed scope. True HEAD/current-branch aliases are grouped, and meaningful scope selection preserves the selected scope's provenance.
- [ ] Created/deleted references have explicit empty-side semantics; no fallback uses current HEAD.
- [ ] Replay changed/dropped/added/uncompared summaries remain attached to their reference and remain visible. Subject-only metadata never becomes guessed paired-commit navigation.
- [ ] Detected renames show old/new paths, including rename-only changes; bounded detection reports its limitation and leaves complete add/delete entries when needed.
- [ ] Binary, mode-only, executable-bit, symlink and gitlink entries report accurate metadata. Symlinks are stored target text and gitlinks are object-pointer changes; no filesystem following or active preview execution.
- [ ] Limits follow the spec; over-limit entries retain identity/count/status, and unavailable content is never rendered as an empty complete diff.
- [ ] Scope changes and concurrent Refresh/Continue/history/worktree switching cannot mix inventory or patches across revisions. Missing/corrupt retained data stays explicit and preserved.
- [ ] Real Git/tool scenarios cover multi-reference rebase, carried-work restoration and repeated Continue; renderer tests cover full-inventory filtering and unavailable states.
- [ ] Relevant guide/feature prose explains scope, rename detection and display limits.

## Blocked by

R2 — consumes its settled review revision, inventory and file-content contract.

## Owned behavior and validation

Own extended review scopes/metadata and corresponding selector/presentation in the existing review surface. Preserve the frozen-read admission boundary. Required checks follow the runbook plus scope, special-file and lifecycle acceptance.
