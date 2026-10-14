# Connected Rehearse review workspace

Status: owner-approved specification; ready-for-agent subject to the published dependency graph and upstream release gate.
Parent: https://github.com/maximalcode/git-city/issues/195
Source findings: #191 (connected review), #193 (lost drafts), #194 (implicit conflict decisions).
Inspected base: develop at 8e1988bcb441cd184150b031e321e79d4152d5e3, equivalent release content to v0.9.2.

The owner requested a plan executable by `implement-spec`. The owner approved these decisions: review-first layout; include the necessary draft/conflict/status improvements; retain drafts across restart; preserve explicit Apply without mandatory per-file acknowledgement; require strict tool-owned matching of the reviewed result at Apply. The remaining product backlog from #192 is excluded.

## Problem Statement

Git City can safely rehearse an operation and adopt its retained result, but users cannot follow a changed file from the rehearsal report to its exact content difference and the corresponding city location. Structural before/after comparison can hide important same-line-count edits. The narrow side panel makes content review and multi-hunk conflict editing awkward, and unsaved conflict text currently disappears on navigation.

Users need to understand what would change, which worktree owns the result, what has actually been checked, and what is still unresolved before explicitly choosing Apply. A clean Git result alone does not answer these questions.

## Solution

A local **Rehearse review** workspace combines the operation result, a complete changed-file inventory, exact frozen content differences, and an optional linked city. Completed results open with content review prominent. Conflicted results open the sandbox editor in the same workspace. The normal repository, saved rehearsals, Undo and recovery remain accessible with their existing ownership and safeguards.

A user can select a file from the list or city, inspect Changes/Before/After, understand missing or omitted content, and confirm Apply for the same retained result. Changing the live checkout never silently substitutes a new comparison. Draft conflict work survives navigation and restart without silently writing or staging in the sandbox.

The existing English product vocabulary remains: Rehearse, Apply, Keep, Discard and Undo Apply. The illustrative German mockup is design evidence, not an application localization requirement. This is local review, not GitHub approval/comment functionality.

## User Stories

1. As a developer, I want a completed rehearsal to open into content review, so I can understand the result before applying it.
2. As a developer, I want the operation, target and original worktree visible, so I know which real workspace would change.
3. As a developer, I want an outcome summary in plain language, so I do not have to interpret duplicated HEAD and branch movements first.
4. As a developer, I want the complete changed-file inventory, so files omitted from the rendered city remain reviewable.
5. As a developer, I want changes marked independently of line count, so a behavior-changing one-line replacement is visible.
6. As a developer, I want the exact retained Before-to-After diff, so later live edits do not replace the result being reviewed.
7. As a developer, I want separate Changes, Before and After content views, so I can inspect both the patch and its context.
8. As a developer, I want file selection to stay consistent across the list, content and city, so each surface describes the same change.
9. As a developer, I want a readable text workflow without 3D, so content review does not depend on spatial interaction.
10. As a developer, I want to resize the review surfaces, so long paths and code fit my window.
11. As a developer, I want to show or hide the city, so I can choose the useful amount of spatial context.
12. As a developer, I want Before and After to share city layout and camera, so movement does not obscure the actual change.
13. As a developer, I want added/deleted paths to show their absent side, so an empty side is not mistaken for a loading error.
14. As a developer, I want both names of a rename, so identity remains understandable before and after it.
15. As a developer, I want binary, mode-only, symlink and gitlink changes explained accurately, so an unavailable text patch is not reported as no change.
16. As a developer, I want limits and unavailable content stated explicitly, so truncated data is not mistaken for a complete review.
17. As a developer, I want a no-op identified clearly, so an empty list is not treated as a failure or an instruction to Apply.
18. As a developer, I want tracked carried work included in its proper scope, so I understand the actual content that would remain after Apply.
19. As a developer, I want untracked exclusion and loss of staging selection explained, so I do not assume the whole local state is simulated.
20. As a developer, I want separately affected reference results selectable, so a multi-reference rebase is not reduced to one misleading combined diff.
21. As a developer, I want replay warnings preserved, so changed, dropped, added and unexamined replay results remain visible.
22. As a developer, I want stale rehearsals inspectable while Apply is refused, so previous work remains useful.
23. As a developer, I want incomplete/stopped/failed results to withhold a finished After, so an intermediate state is not presented as final.
24. As a developer, I want Refresh and Continue to invalidate old content responses, so I never see one result's files beside another result's patch.
25. As a developer, I want missing or incompatible retained data reported explicitly, so the app never substitutes my live checkout.
26. As a developer, I want an unsaved conflict draft to survive file, rehearsal and worktree switches, so navigation does not destroy editing work.
27. As a developer, I want the last durably saved draft restored after restart, so a longer resolution can span sessions.
28. As a developer, I want draft persistence distinguished from Save and stage, so saving a draft does not secretly mutate the sandbox.
29. As a developer, I want persistence failures and pending saves visible, so I know whether closing is safe.
30. As a developer, I want external sandbox changes and my draft retained separately, so neither silently overwrites the other.
31. As a developer, I want every conflict hunk marked unreviewed until explicitly resolved, so default content does not imply my decision.
32. As a developer, I want explicit bulk choices and whole-file editing, so deliberate resolution remains efficient.
33. As a developer, I want Ours/Theirs tied to meaningful operation-specific identities, so rebase does not reverse my intention unnoticed.
34. As a developer, I want failed or partly completed save/stage operations to preserve my draft, so an error does not destroy the resolution.
35. As a developer, I want the final result regenerated after every Continue, so repeated conflict stops cannot reuse old reviewed content.
36. As a developer, I want Git completion, content availability and test/hook status separated, so none is mistaken for code correctness.
37. As a developer, I want Apply to name the exact result and recheck eligibility, so the result confirmed is the one requested for adoption.
38. As a developer, I want actionable reasons when Apply or Undo is refused, so I can proceed without force or automatic stash/reset.
39. As a developer, I want closing to retain work and confirmed Discard to remove only its own drafts, so lifecycle actions stay predictable.
40. As a keyboard or assistive-technology user, I want the full workflow, resizing and confirmations accessible with predictable focus, so no mouse or color discrimination is required.
41. As a developer, I want the ordinary live diff, city selection and GitHub PR panel unchanged when I leave review, so local rehearsal state does not leak into unrelated workflows.

## Implementation Decisions

### Boundary and source of truth

- Git City owns local review presentation and draft persistence; the pinned git-rehearse tool continues to own execution, retained results, Apply, Undo and recovery. No new runtime dependency, scene mode or server is required. Read-only review works on the current tool; the approved strict Apply contract requires the separately planned upstream extension and compatible release.
- Reuse a single main-process resolver for immutable rehearsal endpoints, shared by city comparison and content review. Keep the existing isolation, worktree identity, snapshot ancestry and report recheck protections.
- Renderer requests identify the rehearsal, a review revision, scope and file entry. They do not choose a filesystem repository path, arbitrary revision or unchecked pathspec. A review revision binds canonical identity, completeness, relevant report/replay metadata and resolved endpoint objects.
- A summary/inventory response and every file response carry the same revision. Validate before and after reads; stale responses are discarded. Refresh replaces the snapshot atomically. Retained-object failure is an unavailable state, never a live-file fallback.
- Existing public bridge, query abstraction, state management and queue provide the test and integration seams. Extract only presentation primitives from the ordinary diff viewer; its live/timeline query stays separate.

### Scope and completeness

- The default scope is the original worktree's frozen tracked content before and after the operation, including compatible carried/replayed snapshots. It deliberately excludes untracked files and does not represent preserved staging selection.
- Additional scopes show committed Before/After for affected references. Group true HEAD/current-branch aliases without discarding the underlying movements. Created/deleted references use an explicit absent side. A scope selector appears only when there is a meaningful choice.
- Replay metadata contains subjects rather than authoritative old/new commit pairings. Preserve its changed/dropped/added/uncompared warnings without inventing paired-commit navigation.
- Inventory is derived from immutable object differences, not the report's partial drift list or capped city paths. It includes additions, modifications, deletions, detected renames, mode/type-only changes and non-text entries.
- Rename detection may be bounded for large changesets. If unavailable, show truthful add/delete entries and explain detection was limited; do not fabricate identity. Changed-file review remains complete.
- Stale origin state does not invalidate readable frozen content, but Apply remains governed by backend eligibility. Running, interrupted, failed or unresolved results do not present a finished After. If only committed Before can be verified, label that narrower scope explicitly.
- Large inventories are paged with revision-bound cursors and remain searchable beyond rendered scene limits. Use an initial page size of 200; filtering must search the complete inventory. Totals that cannot be established are unknown, never zero.
- Text display is limited to 2 MiB per endpoint blob and 4 MiB per generated patch. Over-limit/binary entries remain visible with metadata and an explicit unavailable reason. Limits are surfaced and tested; truncated output must never be called a complete patch. Long lines wrap or scroll within the code surface while actions remain reachable.
- Read immutable object bytes. Disable external diff/textconv and replacement-object interpretation; use literal path handling and bounded process output. Avoid mutable attributes/filters changing frozen content interpretation. Symlink targets are text from stored objects, never filesystem destinations; gitlinks are object-pointer changes. No repository code executes as part of inspection.

### Review workspace and city

- Completed results default to a review-first workspace containing the file list and content, with optional city context. Preserve the initiating action and a clear return to live workspace. Existing Automatic/Ask/Off routing remains unchanged.
- Offer unified Changes plus Before and After views. Reuse the existing diff presentation where suitable; split diff is optional reuse, not an additional completion condition. No review checkbox or per-file acknowledgement is required to enable Apply.
- Select the first changed file in a completed result and the first unresolved file in a conflict result. Preserve selection across harmless refresh; if the entry disappears, select a valid neighbour and announce the change. Never reuse selection across another rehearsal identity accidentally.
- Scope and file selection are review-local. The optional city consumes them explicitly. Selecting a rendered changed building selects its entry; selecting a file focuses/highlights its building when represented. Same-LOC modifications have a textual change marker independent of height or color mode.
- Additions/deletions stay selectable on either endpoint; explain absent buildings without changing the selected endpoint. Renames map old/new paths appropriately. A capped/unrepresented file still has its full diff and an explicit city absence reason.
- Render at most one active 3D scene. Retain shared layout and camera across Before/After; return restores live selection and camera context. Review focus respects reduced motion.
- Desktop panes can be resized with pointer and keyboard; bounds clamp on window changes. At 960×700 every primary action remains reachable; at 1280×800 and larger the review-first layout gives content priority. At narrower supported widths stack surfaces and let optional city yield space.
- Use existing product language, colors and theme settings. The schematic buildings and illustrative layout are not assets to copy into the production scene.

### Conflict drafts and decisions

- A draft belongs to canonical origin worktree, full rehearsal identity and conflict path. Its base file/index revision is stored inside the record, not used as a key that discards the old draft when the revision changes.
- Persist versioned drafts atomically in application-owned local storage, with choices/manual text, editing mode, base revision and explicit-decision state. Persist only user editing state, not credentials. Keep a recoverable previous valid record on corruption; preserve unknown/incompatible records with an explanation.
- Show pending/saved/error state. Await persistence during orderly app close/quit; when persistence fails, keep editing available and require an explicit decision before abandoning unsaved work. Crash recovery promises the last acknowledged persisted state, not every unflushed keystroke.
- Draft saving does not write or stage the sandbox. Save and stage remains explicit and revision checked. Successful save clears only the saved revision's draft. Failures retain it; if writing succeeded but staging failed, reread actual state and explain partial completion rather than retrying blindly.
- External revision changes keep draft/base and current sandbox content available. Disable saving the obsolete revision; provide explicit discard/reload or deliberate reconciliation into a new draft based on the current revision. Never merge choices silently.
- Hunks start unreviewed. Explicit side/both/edit choices acknowledge individual hunks; provide a labelled bulk action for remaining hunks and an explicit whole-file decision. Editing invalidates applicable acknowledgements; external revision changes invalidate them all. The save action verifies eligibility as well as rendering it.
- Acknowledging a conflict means choosing its resolution, not proving correctness or completing review of the eventual operation. Continue can introduce another stop or a different result; regenerate the final review.
- Panel close, file/rehearsal/worktree switches and restart retain drafts. Successful confirmed rehearsal Discard removes its drafts afterward; failed discard preserves them. Apply and Continue must not silently abandon outstanding dirty drafts; keep them visible and require deliberate resolution/discard when they conflict with the requested action. No timer deletes drafts.

### Summary, checks and Apply

- Before a run, show relevant tracked/untracked/staging scope concisely from current status, identifying it as a preflight view; the retained report is authoritative after execution.
- After a run, lead with operation result, target/worktree and changed-file count. Preserve actionable replay/conflict warnings. Keep full refs, signature details and technical data available through disclosure.
- State tests not run when no bound test evidence exists; preserve the hook/signature limitations without multiplying persistent warning banners. This feature introduces no test/hook runner or semantic risk score.
- Apply remains explicitly confirmed and backend guarded. Missing visual coverage or a binary diff is explained, not automatically treated as code failure. No extra checkbox implies that clicking means code correctness.
- A confirmation cannot silently adopt a newly refreshed result while naming the old one. Under the approved strict contract, the tool exposes authoritative frozen endpoints plus an opaque result revision, compares the expected revision under rehearsal ownership before effects, and applies that same candidate. Git City requires that capability without silent fallback. App-side review and confirmation checks supplement this contract; they do not pretend to lock external processes. The separate upstream delivery gate is detailed in the runbook. An app-only v1.3.0 precheck is not an accepted substitute.
- Explain carried-work Undo limits before Apply when relevant. After refusal, offer a fresh rehearsal against the same target, inspection of affected work or opening the correct worktree as supported; never force, stash, reset or rerun Apply automatically. Recovery locks take precedence.

## Testing Decisions

- Primary seam: the public GitCityApi bridge and visible user actions. Use existing replaceable bridge for renderer states/races, real temporary Git repositories for content/provenance and the pinned real tool for end-to-end behavior. Private function call order is not acceptance evidence.
- Backend coverage: same-LOC edit; add/delete/rename/mode/type/symlink/binary/gitlink; limits; no-op; carried work states; multiple ref scopes; incomplete and stale results; missing objects; unusual literal names; malicious diff/textconv config; endpoint changes during reads. Compare original HEAD, index and tracked/untracked contents to prove read-only behavior.
- Renderer coverage: identity/scope/file switching, stale async responses, full-inventory filtering, resizing, city absence, one canvas, keyboard/focus, reduced motion and honest errors. Browser preview is appropriate for presentation, not proof of actual Git adoption.
- Draft/editor coverage: two files, navigation, worktree/rehearsal switching, close/reopen, restart, pending/failed persistence, external revisions, save/stage partial failure, explicit hunk/bulk/manual choices and repeated Continue. User edits survive every failure path unless explicitly discarded.
- Real Electron acceptance: review and explicit Apply for merge, normal rebase, interactive rebase and cherry-pick; carried work and stale refusal; conflict→draft restart→deliberate resolution→Continue→final diff→Apply. Assert adoption matches the frozen result shown and unrelated worktrees remain unchanged.
- Complete integration checks: recorded repository gate, typecheck, lint, Vitest, preparation tests, build, relevant browser acceptance and full supported Electron rehearsal suite with the pinned tool. Inspect actual app views at 960×700 and 1280×800+ including keyboard and both long paths and code.
- The implementation PR must pass current CI and all four native package jobs for shipped Windows x64, Linux x64, macOS arm64 and macOS x64. Preserve package/upgrade checks and attach failures as evidence; never reinterpret a skipped safety case as passed.
- Every user-visible slice updates relevant prose in the same PR. Final integration refreshes the real app screenshots, feature inventory, rehearsal guide and keyboard docs affected by the new workspace. Mockups do not substitute for those screenshots.

## Out of Scope

GitHub PR comments/approvals, all remaining #192 ideas, code signing, Farm removal, general large-city aggregation, unrelated search/onboarding improvements, new Git operations, per-commit replay pairing, multi-level Undo, agent/MCP integration, AI explanations/scores, automatic Apply, test/hook execution, new platforms and a new release/tag. Existing restrictions on unsupported repositories stay explicit. The implementation ends in one validated PR to develop; merge/release is a separate action for this feature.

## Further Notes

The illustrative review-first and city-first concepts were tested at 320, 360, 736 and 1024 pixels in light/dark appearance. They establish interaction direction, not production pixel specifications or a full mobile-app commitment.

The product evidence and source anchors are in #192; the draft-loss reproduction is #193 and the conflict-choice proposal is #194. #191 remains an open source finding covered by this specification, not a duplicate parallel implementation ticket. The old integration umbrella #141 and unrelated native-test classification #180 are not implicit prerequisites or extra scope.

The owner approved the product choices, ticket breakdown, test seams and strict Apply boundary. Dispatch uses the published child issues and verified native dependencies; the upstream compatible-release gate remains a real blocker for the final Apply slice. Execution follows the separate runbook in this plan; each worker starts from the current integration tip, not from this historical inspected commit.
