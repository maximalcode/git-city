# U2 — Deliver a compatible conditional-Apply tool bundle

## Parent

Git City #195; upstream release dependency in maximalcode/git-rehearse. Status: draft/external delivery gate.

## What to deliver

A published compatible tool release containing U1 with verified binaries for all four Git City package targets, plus sufficient metadata and retained-data compatibility evidence for Git City's pin.

## Acceptance criteria

- [ ] U1 is merged and validated under the upstream repository's release process; choose the release number from actual versioning rules/current state, never from this draft.
- [ ] Conditional Apply and frozen endpoint descriptors are available in public JSON/CLI for the released build; incompatible/old retained data is preserved and clearly handled.
- [ ] macOS arm64/x64, Linux x64 and Windows x64 artifacts are published and verified, with archive and executable digests plus the exact source revision.
- [ ] Compatibility/upgrade scenarios include retained completed and conflicted rehearsals, carried tracked work, and interrupted recovery metadata supported by current policy.
- [ ] Existing tags remain unchanged; publication follows concrete authorization and the actual release policy.
- [ ] Git City R7 receives the release identity, exact artifact names and checksums. No placeholder pin or development override is treated as a shipped bundle.

## Blocked by

U1 and authorized upstream merge/release. This gate is explicitly unresolved in the draft and cannot be bypassed by a Git City `implement-spec` run.

## Completion boundary

If a run is authorized only to implement/open PRs, report U2 as an external delivery gate. Preserve branches and continue independent Git City slices; do not label R7 or the complete feature done. The earlier v0.9.2 Git City release authorization does not grant a new git-rehearse release automatically.
