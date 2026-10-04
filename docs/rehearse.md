# Rehearse (internal)

Rehearse is an internal development preview for merge, normal rebase,
interactive rebase, and single-commit cherry-pick. It runs the operation in a
retained sandbox so you can inspect its result before changing the real
worktree. Packaged applications keep this entry hidden; public activation is
still gated by the complete safety workflow.

See the [internal development guide](rehearsal-development.md) for tool setup,
mode behavior, conflict editing, recovery, and the safety checks behind Apply.

## The side panel

Choose **Rehearse (internal)**, or open a contextual Rehearse action beside a
branch or commit. Git City opens a nonmodal panel on the right side of the
workspace. The city remains visible beside it, there is no backdrop, and focus
is not trapped inside the panel. The panel shows the operation in its header,
then labels the current branch or checkout and the target or plan base. Retained
reports label the rehearsed branch or checkout, which may differ from your live checkout.

The target form is under **Choose rehearsal target** before the first run and
under **Rehearse again** after a result has been retained. A selected branch,
commit, or interactive-rebase plan is read-only when it comes from another
Git City panel. The current checkout remains unchanged while the sandbox runs.

The primary result area reports the state Git City can verify: preparing or
running, a completed preview, a no-op, conflicts, a failure, an interrupted
result, or a stale retained result. Completed reports summarize branch and
commit movements and the files reported as changed. Open **Review changes** for
the submitted plan, full ref movements, file consequences, and replay warnings.
Actionable conflict and unexpected-content warnings stay in the main report
area.

**Compare city** opens the frozen **Before** and **After** views when a finished
result has an available After. They use the same layout and provide a text
inventory of files and line counts. Stopped, incomplete, failed, and unresolved
results explain when an After view is unavailable. While the comparison is
open, the live scene is paused so the comparison is the only active 3D scene in
the main workspace. **Return to live city** leaves the comparison.

## Running and keeping a result

While a preview or Continue is running, the footer offers **Stop rehearsal**
and **Keep and close**. Stop ends execution and reloads the actual retained
state; it is not a pause and does not promise that Continue or Apply will be
available. Closing keeps execution running in the background. Reopen the
panel with **Rehearse (internal)** to inspect it again.

After execution finishes, the footer offers **Keep for later**. An eligible,
completed, conflict-free result with branch changes also offers **Apply**. Apply
always opens a separate confirmation dialog showing the operation, worktree,
checkout, affected branches, and carried tracked work. Confirming adopts the
checked sandbox result after the backend rechecks the current repository state;
it does not rerun the original Git action. If Apply is unavailable, the footer
explains the reason, such as an active operation, required recovery, conflicts,
no branch changes, or a stale/ineligible result.

## Secondary sections

The panel keeps supporting information available without displacing the current
operation:

- **Saved rehearsals** lists retained entries for the current worktree. Open a
  retained entry, refresh history, inspect storage and low-space warnings, or
  confirm single/batch discard. Active and recovery-protected entries remain
  protected.
- **Undo Apply** appears for the backend-reported last Apply and names the exact
  rehearsal and original worktree. Its confirmation and refusal checks remain
  tied to that Apply.
- **Technical details** contains the retained ID, original worktree, checkout,
  command, sandbox, hook and rerere disclosures, untracked-file caveats, signing
  evidence, and the distinction between signature presence and verification.

Conflict editing, sandbox refresh, repeated Continue, mandatory recovery, and
the Automatic / Ask / Off mode setting retain their existing behavior. The
development guide documents those workflows in detail.

## Keyboard behavior

Tab moves through the panel's controls, including the target form, result
sections, saved history, conflict controls, and footer actions. Enter activates
the focused control. Escape closes the panel only when focus is inside it; it
does not stop a running preview. Focus returns to the control that opened the
panel. Apply, Discard and first-time mode selection use modal confirmation or choice
dialogs, where Escape cancels that dialog instead. Undo has an inline confirmation;
Escape cancels it and returns focus to Undo Apply.
