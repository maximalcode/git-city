# R5 — Make unresolved conflict decisions explicit without needless ceremony

Published issue: [maximalcode/git-city#194](https://github.com/maximalcode/git-city/issues/194)

## Parent

https://github.com/maximalcode/git-city/issues/195; reuse existing #194. Status: approved; ready-for-agent subject to declared blockers.

## What to build

Show which conflict hunks still need a decision, while retaining efficient explicit bulk choices and whole-file editing. Default preview content is not a recorded resolution choice.

## Acceptance criteria

- [ ] Every text hunk initially reports unreviewed; Save and stage is ineligible until every hunk is deliberately resolved or an explicit whole-file resolution is confirmed.
- [ ] Ours/Theirs/both/edit identify their actual operation-specific meaning, including destination and replayed commit during rebase.
- [ ] Remaining-count and next-unreviewed navigation are visible and keyboard usable. Explicit bulk selection for remaining hunks is labelled with its actual effect.
- [ ] Whole-file editing remains practical, with one explicit whole-file decision. Later edits invalidate relevant acknowledgement; an external revision invalidates all acknowledgement without deleting the draft.
- [ ] R1 ([maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193)) persists decisions as well as content across navigation/restart. Save eligibility is verified when invoked, not merely reflected by button styling.
- [ ] Binary selection remains an explicit whole-version action. Rename/deletion external-resolution paths remain truthful and available.
- [ ] The assembled complete result can be inspected before save; no UI claims that explicit choices prove semantic correctness or tests passed.
- [ ] Two-hunk and repeated-Continue Electron scenarios demonstrate one decision cannot silently resolve all remaining sections. Save failures retain draft/decision state and original checkout remains untouched.
- [ ] User guide documents unreviewed, explicit bulk and manual decisions in the same PR.

## Blocked by

R1 ([maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193)) — settled draft ownership, persistence and revision lifecycle.

## Owned behavior and validation

Own conflict decision state, save eligibility and conflict-editor presentation. Consume the existing draft lifecycle and stable editor mounting boundary; do not reshape the review shell. R4 can run concurrently in an isolated worktree. Required checks follow the runbook plus keyboard multi-hunk/rebase acceptance.
