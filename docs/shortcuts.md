# Keyboard shortcuts

Single keys, no modifier — Git City suspends them while a modal dialog, the merge
view, the Rehearse panel, or a text field has focus, so typing a commit message
never toggles a panel.

The **?** button in the top bar reopens the guide that explains what the scene is
encoding (also under Settings → Data → _Show the first-run guide_).

## Panels

| Key   | Does                                    |
| ----- | --------------------------------------- |
| `C`   | Changes — stage, unstage, commit        |
| `B`   | Branches                                |
| `S`   | Stashes                                 |
| `G`   | Commit graph                            |
| `U`   | Time machine (reflog)                   |
| `P`   | Pull requests                           |
| `,`   | Settings                                |
| `Esc` | Close whatever is open, innermost first |

`G`, `U`, `P` and `/` do nothing in a repository with no commits — there is no
history to show yet, so their buttons go inert rather than opening an empty
panel.

## Commit graph

Tab focuses a commit; Enter or Space shows or hides its actions. Tab then reaches
Checkout, Cherry-pick and, in configured development builds, Rehearse cherry-pick.
Space on a focused commit selects it without starting timeline playback.

## The scene

| Key              | Does                                                        |
| ---------------- | ----------------------------------------------------------- |
| `Space`          | Play / pause the history replay                             |
| `V`              | Switch view mode — City ⇄ Farm                              |
| `/`              | Find a file and fly to it                                   |
| `Ctrl`/`Cmd` `K` | Command palette — everything the app can do, fuzzy-searched |

## Mouse

| Action           | Does                                |
| ---------------- | ----------------------------------- |
| Drag             | Pan across the city                 |
| Right-drag       | Orbit                               |
| Scroll           | Zoom                                |
| Click a building | Select it — details, history, blame |
| Hover            | Name and line count                 |

The command palette is the one to remember: it lists every command with its key,
so it doubles as this page without leaving the app.

In the internal rehearsal conflict editor, Tab navigates file buttons, Ours/Theirs/
Both/Edit, text fields, Save and stage, Refresh sandbox and Continue rehearsal.
Enter activates buttons; Escape keeps and closes the rehearsal panel. See the
[Rehearse panel guide](rehearse.md) and [internal rehearsal](rehearsal-development.md#sandbox-text-conflicts).

In the internal interactive-rebase flow, Tab reaches Move up/down and Pick/Squash/Drop;
Enter activates them. Rehearse opens the shared side panel with focus on submission,
and Escape returns to the plan entry.

The internal rehearsal side panel has no focus trap: Tab can return to the
workspace, and city controls remain usable. Enter or Space toggles Review changes,
Saved rehearsals, Technical details and the exact Undo Apply disclosure. Escape
closes the panel only while focus is inside it; closing returns focus to its entry.
Stop and Keep remain in the footer during execution. Apply and Discard
confirmations are modal; Escape cancels them without closing the panel.

In expanded internal rehearsal history, Tab reaches Open, checkboxes and Discard;
Space toggles a checkbox and Enter activates a button. Discard confirmation starts
on Cancel Discard; Escape cancels it and returns focus to Discard selected.
Completion focuses the history heading. These controls remain development-only.

For the internal shared Rehearse mode, Tab reaches the mode selector and arrow
keys change Automatic / Ask / Off. The one-time choice for known repositories
starts on Automatic; Tab and Enter select a mode, while Escape defers the choice.
Supported actions remain blocked until a choice is saved. Automatic opens the
rehearsal result from the existing action; Apply still needs confirmation.
