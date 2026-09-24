# Internal rehearsal

Merge, normal and interactive rebase, and single-commit cherry-pick rehearsal are an internal development preview for #143–#149, not a public
feature. Packaged applications have no entry point and reject these operations.
Checked Apply and mandatory recovery are available only in development. Public
activation remains gated on the complete cross-platform safety workflow.

Use a git-rehearse development build incorporating git-rehearse #87–#90 and #105 (durable
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
stop it. Reopening reloads the current worktree’s retained history. A response arriving after
switching repositories stays associated with its original worktree.

For normal rebase, open **Branches** and activate **Rehearse rebase** beside the
chosen destination branch. For one cherry-pick, select a commit in **Graph** or
open its detail from commit search, then activate **Rehearse cherry-pick**.
The shared panel displays the selected branch or full commit ID as read-only;
focus starts on **Rehearse**. Enter runs the preview, and closing returns focus
to the entry that opened it. These explicit development entries do not change
the existing direct actions. Automatic/Ask/Off routing belongs to a later ticket.
There is no cherry-pick range selector or pull-rebase entry here.

For interactive rebase, open **Branches → Rebase…**, prepare the existing newest-first
Pick/Squash/Drop plan with the up/down buttons, and activate **Rehearse interactive
rebase**. Tab and Enter operate the plan controls; the selected action is announced
as pressed. The rehearsal uses a snapshot of that plan and its base (Root includes
the root commit), with no terminal editor. The oldest instruction is promoted from
Squash to Pick just as in the direct editor; dropping every commit is refused.
The retained report shows the submitted plan, and sandbox Continue preserves the
remaining Git instructions across repeated conflict stops. Review the final report
and confirm Apply to adopt exactly those commit objects. Escape returns focus to
the plan entry. The plan summary is kept in the current app session; restart
inspection through the CLI retains the actual sandbox Git state.

The panel distinguishes conflicts, stopped/failed execution, no-op, refusal and
technical errors. Failed Git commands include their bounded diagnostic output.
An unavailable configured tool shows repair guidance immediately and disables
submission. It shows the original checkout, action, exact retained ID,
branch/commit movements, file consequences, conflicts and unexpected content
changes. Warnings are textual. Repository hooks are disabled by git-rehearse;
a conflict-free result still requires content review. Untracked files are not
represented as carried work.

The CLI receives `--json --keep <merge|rebase|cherry-pick> <target>` (interactive rebase adds
`--todo <prepared-file>` before `rebase -i <base|--root>`) with separate arguments and no
interactive stdin. Closing never issues discard. The bridge's show operation uses
the exact ID and checks repository/worktree identity on the returned report.
The panel reloads `--json list` and inspects the selected exact ID with `--json show`.
The CLI owns retained data; browser preferences remember only the current selection.
After restart, the selection is restored when still present, otherwise the newest
retained entry is selected. Each worktree has its own history and selection.

## History, Stop and storage

**Retained rehearsals** lists every entry for the original worktree, including
outdated results, conflicts and interrupted execution. **Open <ID>** switches the
current result; the pressed/current label identifies it. **Refresh history** reloads
changes made by other CLI processes. Changed checkout/ref bases are marked with a
text warning. This is an inspection hint; Apply still performs its authoritative
checks of refs, local work and worktree occupancy.

**Stop rehearsal** ends only a preview or Continue launched by this app and waits
for its process tree to finish, then reloads the actual retained state. On Unix it
sends termination to the process group and escalates after three seconds if needed;
on Windows it terminates the owned process tree. Apply and recovery cannot be
stopped through this control. An interrupted result is preserved and shown as
incomplete; it cannot be applied or automatically continued. Work active in another
process is labelled and protected; wait for that process to finish, then refresh.
Closing the panel leaves execution running and never issues discard.

Select one or more checkboxes and choose **Discard selected**. The confirmation
names each exact ID, action, worktree, checkout and measured size. Focus starts on
**Cancel Discard**; Tab then Enter confirms. Escape cancels and restores focus to
Discard selected. Completion focuses the history heading. Active or recovery-protected
work is disabled, and the CLI checks those protections again during deletion. A
partial failure names each failed ID; unselected and refused entries remain intact.
Discard never uses the CLI’s implicit latest result or `--all`.

The panel shows total logical bytes for this worktree’s retained entries and the
minimum available space on their storage volumes. Shared/hard-linked Git objects
are included, so logical size is not an estimate of space freed by discard. Less
than 1 GiB available raises a text warning. Unreadable measurements (or no storage
volume yet) are shown as unknown, never zero. There is no timer-based cleanup;
CLI list/pruning continues to preserve explicitly kept work.

Tab, Space and Enter operate history selection, checkboxes, Stop and confirmation.
No new global shortcut is introduced. Save any unsaved conflict-editor text before
switching rehearsals; saved sandbox contents persist across sessions.

## Sandbox conflicts

A stopped merge, rebase or cherry-pick offers **Resolve <file>** in the retained
sandbox. The existing hunk controls offer Ours, Theirs, Both and Edit; **Edit whole
file** allows free text, including files already edited externally. **Save and
stage in sandbox** checks the exact bytes read by the editor before writing and
stages only that sandbox path. A changed file is refused with a text warning;
**Refresh sandbox** reloads it for review. Returning from another app also rereads
the file and preserves choices only when its bytes are unchanged.

Binary conflicts offer **Use ours in sandbox** and **Use theirs in sandbox** to
save and stage a complete version without JavaScript decoding its bytes. Git applies
its checkout encoding/filter conversion; Git-declared binary attributes also
receive whole-file choices. Ours/Theirs refer
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

The management integration tests use real CLI processes for exact discard, active
ownership refusal, recovery protection, linked-worktree isolation, Stop, retained
incomplete state and preservation of non-selected work. Storage failure/low-space
responses are injected without deleting data. The Electron management test closes
and restarts the actual app with the same profile, restores its selected rehearsal,
and exercises single/batch discard confirmation and Stop through keyboard actions.
