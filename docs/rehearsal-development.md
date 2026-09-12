# Internal merge rehearsal

Merge rehearsal is an internal development preview for #143, not a public
feature. Packaged applications have no entry point and reject these operations.
Apply is unavailable until checked adoption and mandatory recovery are complete.

Use a git-rehearse development build incorporating git-rehearse #87 (durable
retention and origin-aware schema 1 reports). Its current version is 1.2.0;
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
technical errors. It shows the original checkout, action, exact retained ID,
branch/commit movements, file consequences, conflicts and unexpected content
changes. Warnings are textual. Repository hooks are disabled by git-rehearse;
a conflict-free result still requires content review. Untracked files are not
represented as carried work.

The CLI receives `--json --keep merge <target>` with separate arguments and no
interactive stdin. Closing never issues discard. The bridge's show operation uses
the exact ID and checks repository/worktree identity on the returned report.
Persistent in-app listing, conflict editing, Apply and recovery belong to later
tickets. For now, after restarting the app, use the configured CLI's `--json list`
and `--json show <exact-id>` from the original worktree to inspect retained work.

## Validation

`npm run typecheck && npm run lint && npm test` runs the normal project checks.
To also run the real CLI safety test, export `GIT_CITY_REHEARSE_BIN` for the test
command. Without it the real-tool test is explicitly skipped. It creates a real
repository, verifies retention and exact identity, and compares HEAD, raw index
bytes and working file bytes before/after merge. It also verifies a no-op and an isolated conflicting merge. The
fixture removes only its own exact rehearsal IDs.

Build with `npm run build`, then run the Electron/real-tool check with
`npx playwright test -c playwright.rehearsal.config.ts` and the same exported
`GIT_CITY_REHEARSE_BIN`. This harness opens a temporary real repository through
the UI and checks keyboard submission, focus, text warnings, disabled Apply,
keep/reopen and unchanged original contents. It starts a development renderer
on port 5199; the packaged renderer keeps the entry hidden.
