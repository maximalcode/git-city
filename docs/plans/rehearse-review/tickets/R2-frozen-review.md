# R2 — Inspect a complete frozen text change from the rehearsal panel

## Parent

Git City #195; source finding #191. Status: draft awaiting approval.

## What to build

From an existing completed rehearsal, select a changed text file and inspect its immutable Changes/Before/After content in the current panel. This is the first independently usable review slice, not a backend-only ticket.

## Acceptance criteria

- [ ] Public review contract returns identity, opaque revision, available scope, frozen endpoint provenance and revision-bound inventory entries; file reads select an entry without renderer-supplied filesystem paths or arbitrary revisions.
- [ ] Scene comparison and content review use one authoritative resolver preserving existing isolated-sandbox, ancestry, carried-work and report-change checks.
- [ ] A same-LOC text replacement, addition and deletion render from immutable objects through bridge and visible file selection; both endpoints can be inspected independently.
- [ ] Default tracked-worktree scope includes compatible carried work and explicitly excludes untracked files/staging preservation. Stale original state remains inspectable; incomplete results withhold a finished After.
- [ ] Complete inventory and filtering are independent of city caps, with revision-bound paging. Unsupported/non-text entries stay present with explicit metadata/unavailable state pending R3, never disappear or claim no change.
- [ ] Harmless refresh preserves selection; changed revision, deleted object, missing sandbox, failed read or switched identity cannot show a stale patch beside a fresh list. No-op is a successful zero-change result.
- [ ] Read-only object inspection uses bounded output, literal paths and disabled external diff/textconv/replace-object interpretation, without invoking filters or following filesystem symlinks.
- [ ] Tests show live original/sandbox edits do not replace the selected immutable result. Adversarial paths/configuration do not execute repository helpers or read an unrelated filesystem target.
- [ ] Ordinary live/historical diff and GitHub PR review behavior remains unchanged; shared diff presentation is separated from their data retrieval.
- [ ] Feature inventory and rehearsal guide document this complete first slice.

## Blocked by

None — read-only review can use pinned git-rehearse 1.3.0. R7 binds Apply to the new expected-result contract when that strict option is approved.

## Owned behavior and validation

Own authoritative review data contract/resolver, safe diff retrieval, minimal panel integration and pure diff presenter extraction. Public API integration, real Git fixtures, renderer races and an Electron clean-rehearsal review prove the slice. Follow runbook shared-resource ownership.
