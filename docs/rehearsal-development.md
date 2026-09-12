# Internal merge rehearsal

Merge rehearsal is an internal development preview for #143–#144, not a public
feature. Packaged applications have no entry point and reject these operations.
Checked Apply and mandatory recovery are available only in development. Public
activation remains gated on the complete cross-platform safety workflow.

Use a git-rehearse development build incorporating git-rehearse #87–#90 (durable
retention, checked Apply, recovery and worktree-aware schema 1 reports). Its current version is 1.2.0;
the older published 1.2.0 does not supply the required report fields. Set
`GIT_CITY_REHEARSE_BIN` to the executable's absolute path before `npm run dev`.
The adapter checks that version and validates the JSON schema and required fields;
unknown fields are tolerated, incompatible results are reported as errors without
deleting retained data. It never searches PATH for this executable or falls back
to a direct merge. Separate tool installation is only for development.

Open a repository, activate **Rehearse (internal)**, enter a branch or commit,
and press **Rehearse**. Tab navigates the native modal, Enter submits the form,
and Escape or **Keep and close** closes it. Focus moves to the result on completion
and returns to the entry button on closing. Closing during execution does not
stop it. Reopening shows the current worktree's result. A response arriving after
switching repositories stays associated with its original worktree.

The panel distinguishes conflicts, stopped/failed execution, no-op, refusal and
technical errors. Failed Git commands include their bounded diagnostic output.
An unavailable configured tool shows repair guidance immediately and disables
submission. It shows the original checkout, action, exact retained ID,
branch/commit movements, file consequences, conflicts and unexpected content
changes. Warnings are textual. Repository hooks are disabled by git-rehearse;
a conflict-free result still requires content review. Untracked files are not
represented as carried work.

The CLI receives `--json --keep merge <target>` with separate arguments and no
interactive stdin. Closing never issues discard. The bridge's show operation uses
the exact ID and checks repository/worktree identity on the returned report.
Persistent in-app listing and conflict editing belong to later tickets. For now, after restarting the app, use the configured CLI's `--json list`
and `--json show <exact-id>` from the original worktree to inspect retained work.

## Apply and recovery

For a clean result with branch changes, **Apply** opens a confirmation showing
its original worktree, action, checkout, affected branches and tracked local work.
Focus starts on **Cancel Apply**; Tab reaches **Apply rehearsal**. No confirmation
word is required. Escape cancels confirmation and returns focus to Apply.
Tracked edits are initially replayed as unstaged changes; the original staging
selection is not restored. The dialog calls this out before confirmation. Git-rehearse checks the current
checkout, refs, local work and worktree occupancy immediately before adoption.
The original Git action is not rerun. A refusal preserves the sandbox and its
report; rehearse again against the new basis to obtain another applicable result.
No-op and incomplete results cannot be applied. After adoption, repository
status, branches, other repository views and scene analysis refresh.

Apply and recovery never use the ordinary index.lock retry. If a response is
lost, the app queries recovery status and reports uncertain completion without
repeating Apply. Review the refreshed repository before another rehearsal.

Opening a repository (including after restart) checks recovery independently of
the preview entry point. Every ordinary write checks again under the same queue
used by Apply, keyed by the common Git directory so linked worktrees share it.
A blocked state shows a textual warning and **Check recovery status**. Only the
CLI's allowed **Complete interrupted apply/undo** and **Roll back interrupted
apply/undo** actions are offered, bound to the reported exact ID and worktree.
From another worktree the CLI may refuse inspection; open the original worktree
to recover. Unknown, damaged or externally changed states remain blocked.
There is no generic repair command that overwrites user files. This protection
is independent of the future Automatic/Ask/Off preference.

Without a configured tool, the app checks for the pinned development CLI's
`rehearse-apply` journal and `rehearse-apply.lock` in the common Git directory and
blocks if either exists. It does not parse or repair those files. A configured
but unavailable or incompatible tool blocks writes until its status can be
checked. Restore the compatible tool; do not delete recovery data to clear a
warning. Packaged applications retain this presence guard without exposing Apply.

## Validation

`npm run typecheck && npm run lint && npm test` runs the normal project checks.
To also run the real CLI safety test, export `GIT_CITY_REHEARSE_BIN` for the test
command. Without it the real-tool test is explicitly skipped. It creates a real
repository, verifies retention and exact identity, and compares HEAD, raw index
bytes and working file bytes before/after merge. It also verifies a no-op and an isolated conflicting merge. The
fixture removes only its own exact rehearsal IDs, including after assertion
failures. A merge-commit fixture installs sentinel hooks through a custom hooks
directory and checks that rehearsal does not execute them; a real commit serves
as the positive control.

Build with `npm run build`, then run the Electron/real-tool check with
`npx playwright test -c playwright.rehearsal.config.ts` and the same exported
`GIT_CITY_REHEARSE_BIN`. This harness opens a temporary real repository through
the UI and checks keyboard submission, focus, text warnings, confirmed Apply,
keep/reopen and unchanged original contents. It starts a development renderer
on port 5199; the packaged renderer keeps the entry hidden.
