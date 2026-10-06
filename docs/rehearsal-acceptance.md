# Rehearse acceptance

Issue [#155](https://github.com/maximalcode/git-city/issues/155) gates public
activation against the [44-story specification](https://github.com/maximalcode/git-city/issues/141).
Test coverage below identifies where to verify each requirement; it is not itself
evidence that a run passed. Public activation requires completed local checks,
real-tool integration, Electron keyboard flows, and all four packaged targets.

## Baseline

The acceptance branch starts at `30d6415984b62ebc52639b585b73a79eff8ee3c4`
on `develop`. Git City #143–#154 and git-rehearse #86–#94, #105, #108 and
#110 are closed. The current upstream release is pinned in
[`rehearse-toolchain.json`](../rehearse-toolchain.json). The original activation
used a pre-release artifact; the v0.9.1 update uses published git-rehearse v1.3.0.

## Story coverage

Paths below are relative to the repository root. Real-tool suites under
`src/main/` require `GIT_CITY_REHEARSE_BIN`; a skipped suite is not acceptance.
Electron suites use the real bridge, Git repositories and executable.

| Story | Requirement                           | Verification source                                                              |
| ----- | ------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | Merge rehearsal                       | `e2e/rehearsal.electron.ts`, `src/main/rehearsal.test.ts`                        |
| 2     | Normal rebase                         | `e2e/rehearsal-actions.electron.ts`, `src/main/rehearsal.test.ts`                |
| 3     | Interactive rebase                    | `e2e/rehearsal-interactive.electron.ts`, `src/main/rehearsalInteractive.test.ts` |
| 4     | Single cherry-pick                    | `e2e/rehearsal-actions.electron.ts`, `src/main/rehearsal.test.ts`                |
| 5     | Automatic, Ask, Off                   | `e2e/rehearsal-mode.electron.ts`, `src/main/rehearsalMode.test.ts`               |
| 6     | Shared worktree setting               | `e2e/rehearsal-mode.electron.ts`, `src/main/rehearsalMode.test.ts`               |
| 7     | New repository default                | `e2e/rehearsal-mode.electron.ts`, `src/main/rehearsalMode.test.ts`               |
| 8     | Existing repository choice            | `e2e/rehearsal-mode.electron.ts`, `src/main/rehearsalMode.test.ts`               |
| 9     | Refusal without silent fallback       | `e2e/rehearsal-mode.electron.ts`, `src/main/rehearsal.contract.test.ts`          |
| 10    | Branch and commit changes             | `e2e/rehearsal-actions.electron.ts`, `src/main/rehearsal.test.ts`                |
| 11    | Files, conflicts, unexpected contents | `e2e/rehearsal-conflicts.electron.ts`, `src/main/rehearsal.contract.test.ts`     |
| 12    | Tracked carried work                  | `src/main/rehearsalRecovery.test.ts`, `src/main/rehearsalComparison.test.ts`     |
| 13    | Frozen city comparison                | `e2e/rehearsal-comparison.electron.ts`, `src/main/rehearsalComparison.test.ts`   |
| 14    | Sandbox text editing                  | `e2e/rehearsal-conflicts.electron.ts`, `src/main/rehearsalConflicts.test.ts`     |
| 15    | Whole-file binary resolution          | `e2e/rehearsal-conflicts.electron.ts`, `src/main/rehearsalConflicts.test.ts`     |
| 16    | External deletion/rename resolution   | `e2e/rehearsal-conflicts.electron.ts`, `src/main/rehearsalConflicts.test.ts`     |
| 17    | External edits invalidate buffers     | `e2e/rehearsal-conflicts.electron.ts`, `src/main/rehearsalConflicts.test.ts`     |
| 18    | Continue to final result              | `e2e/rehearsal-interactive.electron.ts`, `src/main/rehearsalConflicts.test.ts`   |
| 19    | Explicit Apply confirmation           | `e2e/rehearsal.electron.ts`, `e2e/rehearsal-conflicts.electron.ts`               |
| 20    | Adopt exact reviewed objects          | `src/main/rehearsalRecovery.test.ts`, `src/main/rehearsalExecution.test.ts`      |
| 21    | Worktree origin                       | `src/main/rehearsalManagement.test.ts`, `src/main/rehearsalRecovery.test.ts`     |
| 22    | Foreign checkout refusal              | `src/main/rehearsalRecovery.test.ts`                                             |
| 23    | Concurrent independent previews       | `src/main/rehearsalCoordination.test.ts`                                         |
| 24    | Stale result refusal                  | `src/main/rehearsalRecovery.test.ts`, `src/main/rehearsalManagement.test.ts`     |
| 25    | Preserve stale solutions              | `src/main/rehearsalManagement.test.ts`, `src/main/rehearsalRecovery.test.ts`     |
| 26    | Multiple retained selections          | `e2e/rehearsal-management.electron.ts`                                           |
| 27    | Close keeps work                      | `e2e/rehearsal.electron.ts`, `e2e/rehearsal-management.electron.ts`              |
| 28    | Stop keeps incomplete work            | `e2e/rehearsal-management.electron.ts`, `src/main/rehearsalManagement.test.ts`   |
| 29    | Rediscover after restart              | `e2e/rehearsal-management.electron.ts`                                           |
| 30    | Confirm individual/batch discard      | `e2e/rehearsal-management.electron.ts`, `src/main/rehearsalManagement.test.ts`   |
| 31    | Storage and low-space warning         | `src/main/rehearsalManagement.test.ts`                                           |
| 32    | Exact last Apply Undo                 | `e2e/rehearsal-undo.electron.ts`, `src/main/rehearsalRecovery.test.ts`           |
| 33    | Interrupted Apply recovery            | `e2e/rehearsal-recovery.electron.ts`, `src/main/rehearsalRecovery.test.ts`       |
| 34    | Repository-wide recovery lock         | `e2e/rehearsal-recovery.electron.ts`, `e2e/rehearsal-undo.electron.ts`           |
| 35    | Bundled tool on every target          | `.github/workflows/release.yml`, `scripts/smoke-package.mjs`                     |
| 36    | Preserve/migrate retained work        | `scripts/smoke-rehearse.py`, `scripts/smoke-package.mjs`                         |
| 37    | Repair missing/damaged tool           | `src/main/rehearsalBundle.test.ts`, `scripts/smoke-package.mjs`                  |
| 38    | Hooks warning and suppression         | `e2e/rehearsal.electron.ts`, `src/main/rehearsalExecution.test.ts`               |
| 39    | No unsigned downgrade                 | `e2e/rehearsal.electron.ts`, `src/main/rehearsalExecution.test.ts`               |
| 40    | Signature presence versus trust       | `e2e/rehearsal.electron.ts`, `src/main/rehearsal.contract.test.ts`               |
| 41    | Reuse isolated rerere copy            | `src/main/rehearsalExecution.test.ts`                                            |
| 42    | No learned-cache writeback            | `src/main/rehearsalExecution.test.ts`, `e2e/rehearsal.electron.ts`               |
| 43    | Keyboard operation                    | `e2e/rehearsal*.electron.ts`                                                     |
| 44    | Focus and textual warnings            | `e2e/rehearsal*.electron.ts`                                                     |

## Acceptance runs

The original concurrency blocker, [git-rehearse #113](https://github.com/maximalcode/git-rehearse/issues/113),
was fixed in upstream PR #114. The original activation pinned artifact revision
`0ecca205f38fb1bcd88ef2e6a62f6943e2ddc65d` from
[run 37208097702](https://github.com/maximalcode/git-rehearse/actions/runs/37208097702).
All four archive checksums were independently verified against their checksum
files. The artifact, reviewed head and merged upstream commit all resolve to tree
`a544b3784e89f40b733cd7d659c8b07ff74427b2`. Each upstream target passed concurrent worktree previews, Apply and
retained-metadata migration. Git City's previously failing real Electron worktree
regression now passes, including stale Apply refusal and retention.

The activation candidate incorporates `develop` through
`7c1117e4e21240659475f2a373e06ddab8949b72`, including the side panel and focus fixes.
The review fixed point is that commit; the original baseline above records the
first blocked attempt. The candidate removes the internal renderer and packaged
IPC gates together and preserves bundled integrity checks and explicit Apply.

Activation validation completed on 2026-10-04 at commit
`7511311b48268eefd717aaad5fc83754e1bda9ec` in
[run 37215067427](https://github.com/maximalcode/git-city/actions/runs/37215067427):

- Windows x64, Linux x64, macOS arm64 and macOS x64 package jobs all passed.
  Each launched the actual packaged executable twice with one profile, used the
  public keyboard controls to preview and explicitly Apply, checked exact adopted
  commits, retained settings, metadata compatibility and damaged-tool refusal.
- Apple Silicon passed the pinned real-tool suite: **912 passed, 2 skipped**.
  The full Electron suite passed **25/25**, including concurrent worktrees, stale
  refusal, repeated interactive conflicts, recovery, Undo, restart and focus flows.
- Typecheck, lint and the standard test suite passed on all four targets. Local
  typecheck, lint, build and standard tests also passed (**874 passed, 40 skipped**;
  real-tool suites require the explicit tool environment). The complete local
  recovery/Undo rerun passed **17/17**, and both interactive scenarios passed.
- Separate Standards and Spec reviews found no blocking findings. The original
  acceptance-gate finding is satisfied by the completed native run above.

Earlier acceptance runs exposed two fixture errors, both corrected before the
final run: Windows line-ending conversion changed expected file bytes, and the
interactive test inspected the oldest retained preview after creating a new one.
The latter now reads the reviewed identity from the panel and still checks exact
commit adoption. Local recovery tests initially timed out under machine load;
the isolated full-file rerun and the hosted full suite passed.

The [user guide](rehearse.md), feature inventory, troubleshooting,
keyboard reference and real repository screenshot accompany activation. The screenshot
uses the production renderer and a clean temporary clone of this repository,
rehearsing the activation branch onto `develop` without Apply; this avoids changing
the working checkout's unrelated worktree registrations.

Signature presence is not cryptographic verification or signer trust. Sandbox
execution is not operating-system isolation. Tests do not establish control over
external Git processes; safety relies on renewed state checks and refusal.

## Published v1.3.0 integration

Git City v0.9.1 replaces the activation artifact with published
[git-rehearse v1.3.0](https://github.com/maximalcode/git-rehearse/releases/tag/v1.3.0),
tagged at `81a0621b4089749dfa899233a2a3ee06eacad44e`. On 2026-10-06 all four
archives were downloaded and their SHA-256 hashes matched both the published
checksum files and GitHub release asset digests. The manifest also pins the
extracted executable and license hashes. Published upstream smoke records report
Apply, metadata migration and concurrent worktree previews passing on each target.

Git City integration validation is tracked in [#182](https://github.com/maximalcode/git-city/issues/182),
linked to [release tracking #175](https://github.com/maximalcode/git-city/issues/175).
The older activation results above describe their original revision; the v1.3.0
update requires a fresh real-tool suite, Electron acceptance and all four native
package jobs before release.
