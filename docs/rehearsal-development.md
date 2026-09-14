# Internal rehearsal

Merge, normal rebase and single-commit cherry-pick rehearsal are an internal development preview for #143–#147, not a public
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
to a direct Git action. Separate tool installation is only for development.

Open a repository, activate **Rehearse (internal)**, enter a branch or commit,
and press **Rehearse**. Tab navigates the native modal, Enter submits the form,
and Escape or **Keep and close** closes it. Focus moves to the result on completion
and returns to the entry button on closing. Closing during execution does not
stop it. Reopening shows the current worktree's result. A response arriving after
switching repositories stays associated with its original worktree.

For normal rebase, open **Branches** and activate **Rehearse rebase** beside the
chosen destination branch. For one cherry-pick, select a commit in **Graph** or
open its detail from commit search, then activate **Rehearse cherry-pick**.
The shared panel displays the selected branch or full commit ID as read-only;
focus starts on **Rehearse**. Enter runs the preview, and closing returns focus
to the entry that opened it. These explicit development entries do not change
the existing direct actions. Automatic/Ask/Off routing belongs to a later ticket.
There is no range selector, interactive rebase or pull-rebase entry here.

The panel distinguishes conflicts, stopped/failed execution, no-op, refusal and
technical errors. Failed Git commands include their bounded diagnostic output.
An unavailable configured tool shows repair guidance immediately and disables
submission. It shows the original checkout, action, exact retained ID,
branch/commit movements, file consequences, conflicts and unexpected content
changes. Warnings are textual. Repository hooks are disabled by git-rehearse;
a conflict-free result still requires content review. Untracked files are not
represented as carried work.

The CLI receives `--json --keep <merge|rebase|cherry-pick> <target>` with separate arguments and no
interactive stdin. Closing never issues discard. The bridge's show operation uses
the exact ID and checks repository/worktree identity on the returned report.
Persistent in-app listing belongs to a later ticket. For now, after restarting the app, use the configured CLI's `--json list`
and `--json show <exact-id>` from the original worktree to inspect retained work.

## Sandbox conflicts

A stopped merge, rebase or cherry-pick offers **Resolve <file>** in the retained
sandbox. The existing hunk controls offer Ours, Theirs, Both and Edit; **Edit whole
file** allows free text, including files already edited externally. **Save and
stage in sandbox** checks the exact bytes read by the editor before writing and
stages only that sandbox path. A changed file is refused with a text warning;
**Refresh sandbox** reloads it for review. Returning from another app also rereads
the file and preserves choices only when its bytes are unchanged.

Binary conflicts offer **Use ours in sandbox** and **Use theirs in sandbox** to
save and stage a complete version without decoding its bytes. Ours/Theirs refer
to Git stages 2/3; during rebase these mean the destination/replayed commit.
Changed content or conflict stages require a fresh review before saving.

Deletion/rename conflicts with missing stages show external guidance instead of
a text editor. Open the displayed sandbox folder in your editor or terminal,
choose the final paths and contents, and stage each resolution with `git add`
or `git rm` for deletions. **Refresh sandbox**, or returning to the app, rereads
content and conflict status. Missing, renamed or already staged paths cannot be
blindly recreated by an older buffer. Path traversal, symlink paths and hard-linked
files are refused. Requests carry the exact rehearsal ID and originating worktree.

Tab reaches file selection, every hunk choice, editable text, save, refresh and
Continue; Enter activates buttons. Focus moves to the editor heading on file load
and to the report after refresh/Continue. **Continue rehearsal** is available once
no unmerged paths remain. It can stop again at another conflict; resolve each stop
and continue until the final report is complete. Failed, incomplete and stopped
results cannot be applied. Continue keeps the sandbox and never reruns the action
in the original worktree. Closing the panel keeps saved sandbox work; save text
before closing to retain in-app edits.

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
`rehearse-apply` journal in the common Git directory and blocks if it exists.
The persistent lock file alone does not indicate an interrupted operation. It does not parse or repair those files. A configured
but unavailable or incompatible tool blocks writes when a recovery journal is
present; ordinary direct Git actions remain available without a journal. Restore the compatible tool; do not delete recovery data to clear a
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

The real CLI tests also exercise clean rebase and single cherry-pick, retained
identity and origin, exact adopted commit IDs, carried work, and refusal to apply
conflicted results. Electron tests select branches and commits through the real
branch, graph and detail views and verify keyboard submission, focus restoration
and confirmed adoption.

Text-conflict integration tests cover real merge, cherry-pick and repeated rebase
stops, stale editor buffers, wrong identities, traversal/symlink/hard-link refusal,
unchanged original HEAD/index/files before Apply and exact adopted commits/content.
The Electron conflict test exercises hunk choices, free text, stale-buffer warning,
refresh, staging, Continue and confirmed Apply through keyboard actions.
