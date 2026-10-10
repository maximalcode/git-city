# Rehearse review — implementation plan

Owner-facing scope and acceptance: [specification](spec.md).
Execution boundary, ownership and validation: [runbook](runbook.md).
GitHub planning/spec issue: https://github.com/maximalcode/git-city/issues/195.

The owner approved this independently reviewed plan. Implementation uses the published GitHub issues and their native blocking edges; the upstream release gate remains unresolved until compatible artifacts exist.

Implementation is in progress in isolated integration branches. The tool contract
is proposed in [git-rehearse PR #120](https://github.com/maximalcode/git-rehearse/pull/120).
Git City's independent R1–R6 slices are being validated here. R7 and complete
cross-repository acceptance remain blocked by #119: the authorized upstream
merge/release, exact source revision, four platform artifacts with archive and
executable checksums, and retained-data upgrade evidence. No release or merge is
part of this implementation handoff.

## Approved product choices

1. Implement the connected local review workspace and necessary draft/conflict/status protections. Leave the wider 22-item backlog outside this package.
2. Default to review-first, with optional city context.
3. Persist conflict drafts locally across restart, separately from explicit sandbox save/stage.
4. Keep explicit Apply without mandatory per-file checkboxes.
5. Require atomic expected-result matching by git-rehearse for the strict reviewed-result guarantee. An app-only 1.3.0 precheck is not an accepted fallback.

## Ticket graph

The stable planning IDs map to the GitHub issues below. Existing #193 and #194 are reused rather than duplicated. #191 remains the source finding covered by the complete spec.

| Slice | Deliverable                                                      | Published issue                                                                        | Blocked by                                                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1    | apply only the exact publicly identified rehearsal result        | [maximalcode/git-rehearse#118](https://github.com/maximalcode/git-rehearse/issues/118) | None                                                                                                                                                                                                                                                   |
| U2    | deliver a compatible conditional-Apply tool bundle               | [maximalcode/git-rehearse#119](https://github.com/maximalcode/git-rehearse/issues/119) | [maximalcode/git-rehearse#118](https://github.com/maximalcode/git-rehearse/issues/118); authorized upstream merge/release                                                                                                                              |
| R1    | preserve unsaved Rehearse conflict drafts across file navigation | [maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193)         | None                                                                                                                                                                                                                                                   |
| R2    | inspect a complete frozen text change from the rehearsal panel   | [maximalcode/git-city#196](https://github.com/maximalcode/git-city/issues/196)         | None                                                                                                                                                                                                                                                   |
| R3    | review every affected scope and non-text change honestly         | [maximalcode/git-city#197](https://github.com/maximalcode/git-city/issues/197)         | [maximalcode/git-city#196](https://github.com/maximalcode/git-city/issues/196)                                                                                                                                                                         |
| R4    | review and resolve in a wide keyboard-accessible workspace       | [maximalcode/git-city#198](https://github.com/maximalcode/git-city/issues/198)         | [maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193), [maximalcode/git-city#196](https://github.com/maximalcode/git-city/issues/196)                                                                                         |
| R5    | make unreviewed Rehearse conflict hunks explicit                 | [maximalcode/git-city#194](https://github.com/maximalcode/git-city/issues/194)         | [maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193)                                                                                                                                                                         |
| R6    | select the same frozen change in the list, diff and city         | [maximalcode/git-city#199](https://github.com/maximalcode/git-city/issues/199)         | [maximalcode/git-city#197](https://github.com/maximalcode/git-city/issues/197), [maximalcode/git-city#198](https://github.com/maximalcode/git-city/issues/198)                                                                                         |
| R7    | explain the preview and confirm exactly the reviewed result      | [maximalcode/git-city#200](https://github.com/maximalcode/git-city/issues/200)         | [maximalcode/git-city#197](https://github.com/maximalcode/git-city/issues/197), [maximalcode/git-city#198](https://github.com/maximalcode/git-city/issues/198), [maximalcode/git-rehearse#119](https://github.com/maximalcode/git-rehearse/issues/119) |

The Git City implementation frontier initially contains R1 and R2. R5 and R3 become independent when their blockers integrate. R4 waits for the draft lifecycle interface and review contract; R6/R7 wait for the final scope/selection interface. Coordinator-owned complete acceptance is a completion gate, not a separate horizontally sliced testing ticket.

For the approved strict contract, U1/U2 are a separate upstream integration branch and release gate, not fictitious commits in Git City's branch. Read-only/UI work can progress alongside them, but R7 and final acceptance cannot be called complete until the compatible bundle exists. A single-repository `implement-spec` invocation cannot manufacture that external completion.

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

## Publication and execution

The approved spec is #195. Preserve source issue #191's body and link this plan. R1–R7 are native sub-issues, reusing #193/#194 with the approved criteria. Native issue dependencies express all blocking edges, including the cross-repository release dependency.

Planning approval does not itself start implementation, merge PRs or publish a new version. U1 is the next independent upstream implementation; R1/R2 can start in parallel in a separate Git City integration run. Final Git City completion waits for U2.
