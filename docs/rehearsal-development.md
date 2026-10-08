# Rehearse development and updates

For user workflows, modes, conflict editing, local work, recovery and limits,
see the [Rehearse guide](rehearse.md). Packaged applications expose the same
workflow and include their compatible tool. Source builds require an explicit
absolute `GIT_CITY_REHEARSE_BIN`; they never search PATH or download a tool.
Both the development renderer and `npm start` support these source builds.
Git City v0.9.2 requires git-rehearse v1.3.0; re-run preparation and update any
explicit development override when upgrading from the earlier test build.

## Pinned toolchain

`rehearse-toolchain.json` records the published v1.3.0 release tag, source revision,
archive, executable and license checksums for Windows/Linux x64 and Intel/Apple
Silicon macOS. Preparation downloads exact release assets, checks the archive before
extraction, and checks the executable and license before installing them locally.
It does not depend on expiring Actions artifacts. Prepare a target
with `npm run tool:prepare -- darwin-arm64` (or another manifest key), then set
`GIT_CITY_REHEARSE_BIN` to its absolute path under `build/rehearse/<target>`.

Production resolves only `resources/rehearse`, outside ASAR, and verifies the
compiled-in binary/license digests before invocation. Environment overrides cannot
replace the packaged executable. Missing, damaged or incompatible tools give
repair guidance and preserve retained work; Automatic never silently becomes Off.
The executable, MIT license, upstream README and installation notes ship together.

The public JSON CLI is the integration boundary. Git City uses explicit argv,
`--json --keep`, exact IDs and original-worktree identity. The tool owns sandbox
execution, safety, Apply, Undo, recovery and retained metadata. Apply/Undo/recovery
do not use the ordinary index.lock retry. Unknown completion causes inspection.
App-owned coordination uses the canonical common Git directory; external tools
remain outside that queue, so authoritative CLI checks still determine safety.

## Validation

Run `npm run typecheck && npm run lint && npm test`. Export
`GIT_CITY_REHEARSE_BIN` for the test command to include real-tool integration;
without it those suites are explicitly skipped and do not count as acceptance.
Preparation regressions run with Python 3.10+ using
`python3 -m unittest discover -s scripts -p 'test_*.py'` (also run by CI and each
native package job). They cover release selection, checksum failures, destination
preservation and safe extraction.
Tests use disposable real repositories and verify HEAD, refs, raw index bytes,
files, exact retained IDs and resulting action availability.

After `npm run build`, run
`npx playwright test -c playwright.rehearsal.config.ts` with the same executable.
This exercises the Electron bridge, real Git/tool execution, keyboard and focus,
all action entries, repeated conflicts, history/restart, parallel worktree previews,
stale refusal, Apply, Undo, recovery and frozen city comparison. The production
renderer case verifies existing-repository mode choice and Automatic routing.

The Release workflow builds native packages on all four targets, then runs
`scripts/smoke-package.mjs` against the actual packaged executable. It launches
with a bogus development override, opens a real repository, performs a keyboard
preview/confirmed Apply, verifies the resulting commit and file, and repeats after
restart. Corrupted bundled files must give repair guidance without mutation or
changing Automatic. The extracted CLI also runs Apply and metadata migration
checks through `scripts/smoke-rehearse.py`. PR/manual runs produce artifacts only;
public releases still require the normal tag/release process.

Confirmed Apply has a dedicated five-minute smoke assertion; ordinary UI checks
retain their 90-second timeout. In the Windows [#179 reproduction](https://github.com/maximalcode/git-city/actions/runs/37508936206),
temporary CPU contention made one Apply take 222 seconds: the old assertion failed
at 90 seconds, but the same CLI process exited successfully and IPC returned
`applied` with no recovery required. The timeout covers that observed completion
with headroom. The smoke still requires the exact success message, target HEAD,
and expected file contents; it never retries Apply to obtain a passing result.

Packaged smoke runs retain diagnostic artifacts under
`test-results/package-smoke/<platform>-<restart>/`, uploaded by the Release workflow.
They record Apply request and subprocess timing, exact repository/file hashes, and
recovery state. On failure the smoke captures the page and retained metadata, then
observes an outstanding Apply for up to another 180 seconds before closing the app.
Late completion does not turn the original failed assertion into a pass. Set
`GIT_CITY_SMOKE_DIAGNOSTICS_GRACE_MS=0` to skip that extra observation locally.
Diagnostic inspection does not retry Apply or perform recovery. Initial/final
capture and closing the test app have separate bounded allowances. Set
`GIT_CITY_SMOKE_RESTARTS` between 2 and 10 to repeat the complete smoke sequence
with the same profile (default: 2).

The [44-story acceptance inventory](rehearsal-acceptance.md) identifies evidence
and its revision. Run the complete suite whenever the toolchain pin changes;
unit doubles do not prove Git safety or concurrent CLI behavior.

## Retained work across updates

The tool's schema-1 to schema-3 migration must preserve exact original bytes in
`meta.json.bak` before conversion, keep saved sandbox edits and optional fields,
and tolerate repeated reads. Backup failure must leave the source unchanged.
Missing legacy origin prevents Apply. Unsupported future schemas are preserved
byte-for-byte and refused; do not delete data to clear an error. Git City does
not scan, rewrite or prune retained metadata during updates.

## Frozen city integration

Comparison reads immutable objects from the exact retained sandbox after checking
identity through public JSON `show`; it never checks out a commit or uses live
original HEAD as a fallback. Before includes tracked carried work; After includes
restored carried work only for a completed result. Untracked files are excluded.
The adapter reads pinned `refs/rehearse/carried` and `refs/rehearse/replayed` stash
commits and checks their first parents. This is an explicit compatibility assumption
beyond the JSON schema and requires the real-tool comparison tests on updates.
A second endpoint check rejects changes during analysis.

## Real screenshots

Build, configure the development executable, then run
`npm run media:app -- --only=app-rehearsal --rehearsal-target=HEAD` to capture the
real app on this repository without Apply. Source capture supports the production
renderer; `ELECTRON_RENDERER_URL` is optional. Capture a meaningful target in a
controlled repository when showing changed-file or conflict states. Never apply
or discard existing user work for a screenshot.
