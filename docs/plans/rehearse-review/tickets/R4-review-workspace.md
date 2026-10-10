# R4 — Review and resolve in a wide keyboard-accessible workspace

Published issue: [maximalcode/git-city#198](https://github.com/maximalcode/git-city/issues/198)

## Parent

https://github.com/maximalcode/git-city/issues/195. Status: approved; ready-for-agent subject to declared blockers.

## What to build

Open Rehearse results into a content-first workspace with a complete file list, comfortable diff/editor, optional city region and reachable actions. Preserve existing operation entry, management, Undo and recovery.

## Acceptance criteria

- [ ] Completed results show changed-file content prominently; conflict results open the first unresolved sandbox file. Running, no-op, failed, stale and recovery states have accurate actions.
- [ ] Review-local identity/scope/entry state drives list and content. Closing returns to the initiating live context without changing ordinary selection or GitHub PR review state.
- [ ] Panes resize with pointer and keyboard, clamp to window bounds and retain useful preferences. The workspace remains nonmodal; confirmations retain modal semantics.
- [ ] At 960×700 and 1280×800+, long paths/code do not hide primary actions; narrower widths stack content and let optional city yield space. No horizontal page overflow.
- [ ] Keyboard navigation and announcements identify selected file, content view and status without excessive focus stealing. Refresh never moves focus from active typing merely because background data arrived.
- [ ] Existing Keep/Stop/Discard/history/Undo/recovery/explicit Apply flows remain reachable. Entry mode behavior and backend guards remain intact.
- [ ] R1 ([maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193))'s draft protection remains active through all new navigation/close paths. Dirty-draft prompts target the actual pending action and restore focus on cancel.
- [ ] Stable view-model inputs allow the later city ticket to attach selection without changing the live store.
- [ ] Browser plus real Electron walkthrough covers completed review, conflicts, restart restoration, stale refusal, keyboard resize and Cancel-first Apply confirmation.
- [ ] Update the guide, relevant keyboard references and real app capture workflow for the new workspace; final media comes from the actual implementation.

## Blocked by

R1 ([maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193)) — safe draft navigation/close contract.
R2 ([maximalcode/git-city#196](https://github.com/maximalcode/git-city/issues/196)) — usable frozen review contract and presentation.

## Owned behavior and validation

Own workspace shell, layout, selection/preferences, focus and operation entry integration. Do not rewrite conflict-editor internals owned by R1 ([maximalcode/git-city#193](https://github.com/maximalcode/git-city/issues/193))/R5 or endpoint retrieval owned by R2 ([maximalcode/git-city#196](https://github.com/maximalcode/git-city/issues/196))/R3. R5 may run independently against the stable editor boundary. Required checks follow the runbook.
