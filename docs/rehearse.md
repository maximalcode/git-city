# Rehearse

Rehearse runs Merge, normal or interactive Rebase, and a single Cherry-pick in a
retained sandbox. Review the result, resolve conflicts there, then explicitly
confirm **Apply** to adopt the reviewed result in the original worktree.
A clean Git result is not proof that the resulting code is correct.

Public activation is currently gated by [acceptance](rehearsal-acceptance.md).
Until that gate is removed, use the [development setup](rehearsal-development.md).

## Choose a mode

The **Rehearse mode** setting is shared by all linked worktrees of a repository.
New repositories use **Automatic**. For repositories already in Git City's recent
list, choose a mode once; Escape postpones the choice and blocks supported actions
until you choose. Repositories previously removed from that list cannot be
recognized as existing repositories.

- **Automatic** sends Merge, Rebase, interactive Rebase and single Cherry-pick
  actions directly into a rehearsal. Apply still requires confirmation.
- **Ask** keeps direct actions and offers explicit **Rehearse** entries beside
  them. Choosing a manual entry opens its preview form.
- **Off** uses direct Git actions. Retained work and required recovery remain
  accessible; changing mode never deletes sandboxes or bypasses a recovery lock.

Pull (including pull with rebase), Fetch and Push are outside this routing.
A failed rehearsal never silently retries the original action directly. Repair
the tool or consciously choose Off if direct execution is appropriate.

## Review and resolve

Use **Rehearse** for a merge target, **Rehearse rebase** in Branches, or
**Rehearse cherry-pick** on a selected commit in Graph or commit details.
The interactive rebase editor supports its existing Pick, Squash, Drop and
up/down controls. Review the submitted plan, including every repeated conflict
stop, before Apply.

The report identifies the worktree, exact rehearsal, action, refs, commits,
affected files, conflicts, unexpected content changes and carried tracked work.
**Compare city** switches the same scene between the frozen **Before** and
**After** states. The text inventory lists files and line counts. Incomplete
results do not have a finished After. Comparing does not switch the real checkout.

For a text conflict, choose **Resolve**, then Ours, Theirs, Both, Edit, or
**Edit whole file**. **Save and stage in sandbox** saves to the sandbox only.
Binary conflicts offer a complete Ours/Theirs version. During rebase, these
mean the destination and replayed commit respectively. For deletion or rename
conflicts, follow the displayed sandbox path and external staging instructions.

**Refresh sandbox** rereads external edits. Returning to the app also refreshes
the file; stale editor contents cannot silently overwrite a changed file.
Once all unmerged paths are resolved, **Continue rehearsal** runs the remaining
operation. Resolve each new conflict stop until the report is complete.
Save editor text before closing or selecting another rehearsal.

## Apply and local work

**Apply** opens a confirmation naming the original worktree, action, checkout,
branch changes and tracked local work. Review it, then choose **Apply rehearsal**.
The backend rechecks the checkout, refs, index, local files and other worktrees.
It adopts the reviewed commit objects rather than rerunning the original action.

Tracked local changes are replayed in the sandbox and can themselves conflict.
After Apply, carried edits are unstaged: the original staging selection is not
restored. Untracked files are not carried work. New collisions, changed local
work, stale refs or branches checked out elsewhere cause refusal, preserving
the retained result for inspection. Create a new rehearsal against the new basis.
There is no force option. A no-op needs no Apply.

## Keep, stop and discard

**Keep and close** leaves saved work intact. Closing during execution does not
stop it. **Stop rehearsal** preserves an incomplete result, which is not
automatically resumable or applicable. Apply and recovery cannot be stopped
through this control.

Retained history restores the current worktree's selection after restart.
Use **Open** to switch results and **Refresh history** to discover external
changes. Select entries and use **Discard selected**; confirmation names each
exact result. Active work and recovery data cannot be discarded. No timed cleanup
deletes retained work. Displayed logical size includes shared objects and is not
an estimate of space freed. Low available space produces a textual warning;
unknown measurements remain unknown.

## Undo and recovery

**Undo Apply** identifies the exact last Apply and its original worktree,
independently of which rehearsal is selected. Confirm **Undo this Apply** only
after reviewing that identity. Changed refs, foreign checkout occupancy or local
changes—including carried uncommitted edits—can prevent Undo. It is not a general
recovery mechanism for arbitrary file edits.

After an interrupted Apply or Undo, **Recovery required** blocks ordinary writes
across the repository's worktrees. Open the original worktree and use only the
offered **Complete interrupted apply/undo** or **Roll back interrupted apply/undo**
action. Unknown or externally changed states remain blocked. Do not delete journals
or sandboxes to remove a warning. Lost responses trigger inspection, never blind
retries. External Git tools are not locked by Git City; their changes can cause
recovery to refuse.

## Hooks, signatures and limits

The report says **Repository hooks were not run**: hooks are disabled during
rehearsal and Apply. Off keeps existing direct-action hook behavior. Existing
rerere settings and solutions are copied into the sandbox; newly learned solutions
are not written back to the original cache.

Signing settings remain effective, and signing failures do not downgrade to
unsigned commits. System signing dialogs may appear; terminal editors and prompts
are disabled. **Signature present** reports presence only. **Verification: not
checked** and **Signer trust: not checked** are separate facts. Git City stores
no signing keys.

The sandbox is not operating-system isolation: configured merge drivers and other
programs can run. Existing git-rehearse restrictions, including unsupported
submodule, LFS, shallow and empty repositories, still produce refusal.
There is no range cherry-pick, force Apply/Undo, automatic Apply, hook opt-in or
independent background tool update. App and tool versions are validated together;
incompatible retained data must be preserved, not deleted to make an update work.

## Keyboard and focus

Tab and Shift+Tab reach controls; Enter activates buttons and submits the preview.
Space toggles checkboxes; arrow keys change the mode selector. Rehearsal completion
focuses the textual result. File selection focuses the editor heading; refresh and
Continue return focus to the report. Compare city initially focuses Before.

Apply, Undo and Discard confirmations initially focus Cancel. Escape cancels a
confirmation or keeps and closes the panel, restoring the initiating control.
Required recovery focuses its warning. Status and warning text accompanies color.
No new global shortcut is required; see [keyboard reference](shortcuts.md).
