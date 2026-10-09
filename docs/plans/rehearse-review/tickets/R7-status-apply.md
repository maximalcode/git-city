# R7 — Explain the preview and confirm exactly the reviewed result

## Parent

Git City #195. Status: draft awaiting approval.

## What to build

Make result scope and verification limits understandable, and carry the displayed result identity through explicit Apply confirmation into the backend/tool check. Explain refused Apply/Undo without weakening their safeguards.

## Acceptance criteria

- [ ] Preflight concisely identifies tracked work, untracked exclusion and staging consequences from current status. The retained report supersedes preflight after execution.
- [ ] Completed summary leads with operation outcome, affected branch/worktree and real changed-file count. Full ref/hash detail and consequential replay warnings remain available.
- [ ] Git completion, content availability, tests not run, skipped hooks and unverified signatures are distinct facts. Use concise disclosure rather than a wall of duplicate warnings.
- [ ] Confirmation identifies origin, action, refs/local work and displayed review revision. Refresh or change while it is open invalidates the pending confirmation rather than replacing its subject silently.
- [ ] Under the recommended strict contract, Apply passes the tool's expected result revision; git-rehearse checks it under ownership before any effects and retains that checked result through adoption. A changed carried snapshot with unchanged public carry status is also refused.
- [ ] App-side admission serializes relevant editing/Continue/Apply consistently and checks its complete review revision. It never impersonates tool lock files or claims an in-memory lock excludes external processes.
- [ ] Existing recovery, stale state, foreign-worktree occupancy, local-work/collision, no-op and tool-availability guards remain. Missing expected-revision capability gives a clear compatibility refusal, never silent downgrade.
- [ ] Explain carried-work Undo limitations before Apply; refused actions show the relevant reason and safe supported next action, without automatic stash/reset/force/retry.
- [ ] Dirty drafts are not silently discarded by Apply/Continue. Optional viewing/selection is not a semantic correctness guarantee or mandatory per-file checklist.
- [ ] Real-tool/Electron tests demonstrate exact result adoption, external mutation refusal, confirmation invalidation and unchanged original state on rejection for supported operations.
- [ ] Migrate the shared resolver so both city and content consume U1's authoritative endpoint descriptors and matching result revision. Old 1.3 retained rehearsals are tested through the new tool; if their endpoints cannot be established authoritatively, preserve the data and refuse the unavailable review/conditional Apply instead of inferring a substitute.
- [ ] Bundle pin/artifact metadata and compatibility tests use the approved tool release. Docs accurately state the actual guarantee and limitations.

## Blocked by

R3 — complete review scope/revision semantics.
R4 — final workspace summary/action surface.
U2 — published compatible tool artifacts for strict conditional Apply.

If the owner chooses the explicitly narrower v1.3.0 plan, rewrite this ticket before publishing: retain app-side revision/admission checks, document the external-process check-to-use gap, remove atomic claims and the U2 dependency. Do not mix those two contracts during implementation.

## Owned behavior and validation

Own outcome/scope/check copy and Apply/Undo confirmation integration, expected-result admission and approved tool pin. Consume review selection/data and draft lifecycle; preserve tool-owned safety. Required checks include the complete native package matrix at the final integrated tip.
