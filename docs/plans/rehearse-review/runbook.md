# implement-spec execution runbook

## Readiness and scope

Read the approved #195 specification, its final child issues/native blockers, repo instructions and domain docs. This local draft is not the dispatch input until the owner has approved the product choices and ticket graph and the tracker contains stable IDs. Do not infer approval from a default option in a pending question.

The user asked for planning. Do not start implementation from this planning session. The final handoff will invoke `implement-spec` against the approved Git City #195 after publication of its graph. Strict conditional Apply also needs the upstream U1/U2 flow below.

## Repositories and delivery

- Git City: base current origin/develop at implementation start; one integration branch named feat/195-rehearse-review; one PR to develop. Keep main/release tags untouched. Record the actual base and final tested tip.
- git-rehearse, strict path only: its own issue, current develop base, isolated integration worktree and PR. U1 changes its public contract; U2 supplies a compatible public release. A Git City worktree cannot absorb Rust commits from a separate repository as though they belonged to its integration branch.
- Current capacity allows at most three simultaneous child agents; dispatch only the ready ticket frontier and serialize integration. Worktrees start at the current validated integration tip. Current local checkouts belonging to other tasks are preserved.
- Existing #193/#194 become R1/R5 after approved criteria are added; #191 is the source finding and closes only when the full covered feature merges. No issue closes merely because a worker reports completion.
- Implementation ends with validated branch/PR and evidence. New feature merges/releases are separately scoped; the prior v0.9.2 authorization is not reused.

## Shared contracts to pin before parallel dispatch

These names identify owned additions, not permission to redesign existing APIs.

| Owner | Public seam / responsibility                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1    | RehearsalDraftKey/Record/Status; read, persist and deliberately remove an owned draft; draft lifecycle/save-eligibility facts for the editor.               |
| R2    | RehearsalReviewIdentity/Revision/Scope/Entry; review summary, paged inventory and selected-file content requests; authoritative shared endpoint resolution. |
| R3    | Additional scope/file-kind and replay metadata through the R2 contract; no parallel redefinition of identity/revision.                                      |
| R4    | Review-local selected scope/entry, content view, widths and city-visible preference; explicit callbacks into draft/editor lifecycle.                        |
| R5    | Conflict acknowledgement state and its contribution to save eligibility, through R1's persisted record; no separate draft store.                            |
| R6    | Explicit rehearsal focus/pick inputs and markers consuming R4 selection and R3 endpoint scopes; preserve default live scene behavior.                       |
| R7    | App-to-tool result revision admission and compatibility; user-facing scope/check status and Apply/Undo confirmation.                                        |

Use the [shared contract note](contracts.md) for the agreed request/response vocabulary and owned integration surfaces; verify compatibility before dispatch. R1 and R2 may each add only their named section to shared types, preload and IPC registration in their isolated worktrees; keep changes additive. They must not rename or reformat the other's sections. Integrate one result at a time and resolve registration/import additions by intent. If exploration reveals an unsettled shared signature, resolve it before dispatch or add a genuine scheduling blocker; do not let parallel workers guess different contracts.

R2 may extract pure diff presentation from the ordinary DiffPanel while preserving its data query. R1/R5 own conflict editor internals. R4 mounts that stable interface and owns shell/focus/layout, so it can run alongside R5. R3 owns the controlled scope selector and scope model; R4 owns its placement and selected-scope state. The selector consumes the provided scopes and selectedScopeId and emits onSelectScope(scopeId); neither worker duplicates that state. R6 owns scene binding and camera selection inputs; R7 owns summary/actions. Scope CSS and fixture changes accordingly instead of globally reformatting shared files.

Documentation belongs in each slice. Final screenshots/feature inventory are reconciled by the coordinator after all integrated behavior is present; that does not excuse leaving per-slice user-facing prose until another PR.

## Apply identity: strict and narrower options

Current v1.3.0 checks original-state safety and fresh public report fields before applying. It does not accept an expected reviewed result. An app-side check followed by a separate CLI Apply has a gap in which another CLI operation could change the retained result. App memory locks do not remove this gap.

Recommended strict plan: U1 exposes a public result revision plus endpoint descriptors; Git City derives its local review revision from that authoritative result and uses the same descriptors for scene and diff. R7 passes the expected result revision to conditional Apply. The tool compares and applies the same candidate under its ownership. Revalidate app state and preserve all existing safety checks too. Scope the concurrency guarantee to cooperating operations and unchanged immutable objects; do not claim arbitrary external filesystem processes are controlled.

If the owner explicitly selects the narrower 1.3.0-compatible plan, remove U1/U2 from the approved graph, retain a full app-side revision comparison before Apply and document the remaining external check-to-use gap in specification, UI guarantee and tests. Do not label it atomic expected-result Apply. No worker may choose this fallback merely because U2 is unavailable.

## Highest test seam and required checks

Use public bridge requests and visible user interactions as the principal seam. Real Git/tool integration proves provenance and safety; bridge fakes prove presentation and race handling. Extend existing fixtures and Electron harnesses rather than inventing access to private helper methods.

Each worker uses TDD for new behavior and records tested revision, commands, results and limits. Every integrated result reruns its relevant checks before the next frontier advances. Run repository gate through its recorder, plus the required full test suite:

- quality-runtime record-gate --root <integration-worktree> --gate
- npm run typecheck, npm run lint, npm test
- python3 -m unittest discover -s scripts -p 'test_*.py'
- npm run build
- Relevant existing/new browser Playwright tests, with explicit viewport.
- Full supported Electron rehearsal suite with the real pinned tool using playwright.rehearsal.config.ts; use the documented development preparation for the local platform.

At the complete integrated tip, run the mandatory full code review against the recorded base with #195 supplied as spec. Resolve blockers, rerun invalidated checks and re-review. The PR must show CI plus four native package jobs green, preserving packaged tool/upgrade smoke checks. The UI was changed, so actual visual inspection and fresh real-app captures are required; static mockups are insufficient.

## Acceptance evidence matrix

Record each scenario, platform/window size, tested commit, pass/fail and evidence location:

1. Clean merge with same-LOC change → list, diff, city → explicit Apply.
2. Normal rebase, interactive rebase and single cherry-pick through the same review path.
3. Tracked carried work vs untracked exclusion and staging consequences.
4. Two conflicts → navigate/restart → external revision → deliberate reconciliation → repeated Continue → exact final result.
5. Created/deleted/renamed/binary/mode/symlink/gitlink/large entries and scope selection; no false empty diff.
6. Stale original state, missing metadata/object and malicious helper/path fixtures preserve original state and explain refusal.
7. Identity/version races during read, Refresh, Continue, scope and worktree switching.
8. Strict Apply expected-result change, including carried objects whose high-level carry metadata did not change; no effects on rejection.
9. Keyboard-only at 960×700 and 1280×800+, resizing, focus restoration, reduced motion, explicit Cancel-first confirmations.
10. Exactly one active scene, capped/absent file messaging and restored live selection on return.
11. Existing history, Keep, Discard, Stop, Undo, recovery and tool-unavailable flows remain usable.
12. All four native packages use the approved tool and preserve retained data through the existing upgrade smoke.

## Final handoff template after approval

“Use implement-spec for maximalcode/git-city#195 and its approved child graph from current develop. Follow the recorded contracts, documentation and acceptance matrix. Use isolated workers, one integration branch and a final PR to develop. Preserve existing work; do not merge or release as part of this implementation instruction. Under the strict plan, treat the referenced git-rehearse conditional-Apply release as an explicit external blocker for R7; coordinate its separate upstream implementation/delivery first or report the exact gate while independent slices progress.”

Do not advertise this template as a ready one-command complete run while U2 or owner approval is unresolved.
