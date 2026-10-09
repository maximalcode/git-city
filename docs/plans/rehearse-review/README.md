# Rehearse review — implementation plan

Owner-facing scope and acceptance: [specification](spec.md).
Execution boundary, ownership and validation: [runbook](runbook.md).
GitHub planning/spec issue: https://github.com/maximalcode/git-city/issues/195.

This is a reviewed draft awaiting the owner's product choices and approval of the ticket breakdown. Do not dispatch workers from this version or mark its issues ready-for-agent.

## Recommended product choices

1. Implement the connected local review workspace and necessary draft/conflict/status protections. Leave the wider 22-item backlog outside this package.
2. Default to review-first, with optional city context.
3. Persist conflict drafts locally across restart, separately from explicit sandbox save/stage.
4. Keep explicit Apply without mandatory per-file checkboxes.
5. Require atomic expected-result matching by git-rehearse for the strict reviewed-result guarantee. The alternative is a narrower 1.3.0-compatible plan that explicitly retains the external-process race limitation.

## Ticket graph

Stable draft IDs become GitHub issue IDs only after approval. Existing #193 and #194 are reused rather than duplicated. #191 remains the source finding covered by the complete spec.

| Draft | Deliverable                                                                       | Existing issue             | Blocked by                                  |
| ----- | --------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------- |
| U1    | Conditional Apply of the publicly identified result, checked under tool ownership | To resolve in git-rehearse | None                                        |
| U2    | Publish compatible tool artifacts and verify retained-data compatibility          | To resolve in git-rehearse | U1 plus authorized upstream merge/release   |
| R1    | Preserve conflict drafts across navigation, external refresh and restart          | #193                       | None                                        |
| R2    | Read a complete frozen text change end to end                                     | New                        | None; tool 1.3.0 supports read-only work    |
| R3    | Review all affected scopes and non-text/edge-case changes                         | New                        | R2                                          |
| R4    | Use a wide, accessible content-review workspace                                   | New                        | R1, R2                                      |
| R5    | Resolve conflicts through explicit, efficient decisions                           | #194                       | R1                                          |
| R6    | Select the same change in list, diff and city                                     | New                        | R3, R4                                      |
| R7    | Understand scope/check status and confirm the exact result                        | New                        | R3, R4, U2 for strict expected-result Apply |

The Git City implementation frontier initially contains R1 and R2. R5 and R3 become independent when their blockers integrate. R4 waits for the draft lifecycle interface and review contract; R6/R7 wait for the final scope/selection interface. Coordinator-owned complete acceptance is a completion gate, not a separate horizontally sliced testing ticket.

For the strict recommendation, U1/U2 are a separate upstream integration branch and release gate, not fictitious commits in Git City's branch. Read-only/UI work can progress alongside them, but R7 and final acceptance cannot be called complete until the compatible bundle exists. A single-repository `implement-spec` invocation cannot manufacture that external completion.

## Concrete acceptance walkthrough

1. Rehearse a merge with a same-line-count edit. Select its file and see both exact endpoints and a visible city change marker.
2. Inspect an added/deleted/renamed file and a binary/mode-only entry; absence and unavailable content remain honest.
3. Move the original branch externally: the frozen result stays inspectable, but Apply is refused.
4. Edit two conflict files, switch away, close/reopen and restart. Recover drafts without changing the sandbox until Save and stage.
5. Change the sandbox externally while a draft exists. Keep both versions and deliberately reconcile against the new revision.
6. Resolve a multi-hunk conflict including an explicit bulk/manual choice; Continue through another stop, then inspect the final result.
7. Switch rehearsal/worktree during an outstanding diff read. No late response changes the visible selected result.
8. Review affected references and tracked carried work without confusing their scopes or staging semantics.
9. Confirm Apply with the reviewed result identity. A changed result is refused before effects under the strict tool contract; the adopted bytes/objects match the accepted result.
10. Complete the same workflow by keyboard at laptop size; optional city never hides the content or primary actions. Leaving review restores the live workspace.

## Publication after approval

Publish the final spec as #195 with ready-for-agent. Preserve source issue #191's body and link the approved plan. Add R1–R7 as native sub-issues, reuse #193/#194 with approved criteria, and add native blocking edges using issue database IDs. U1/U2 belong to git-rehearse; record the cross-repository dependency using supported native links or an explicit blocking reference if the platform cannot express it.

Only after those IDs and edges are verified should the runbook receive the final `implement-spec` invocation. Planning approval does not itself start implementation, merge PRs or publish a new version.
