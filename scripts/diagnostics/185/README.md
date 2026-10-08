# Git City #185 Windows smoke evidence

This directory holds bounded diagnostic helpers for [Git City #185](https://github.com/maximalcode/git-city/issues/185). The question is why the packaged Windows smoke can fail while invoking the Python Rehearse smoke child. This note records observations only; it does not claim a cause or a fix.

## Baselines and runs

- Application/toolchain baseline: `60530295e3b4baad610faf6e028f7cbbdc602a14` (merge of #183, including the published `git-rehearse` v1.3.0 integration).
- Native tracing commit: `7f506d34fdc3782a91908456cd2baefd1dfa38e3`.
- Standalone-versus-packaged comparison commit: `2d2dfa655b4dbbd14429b09aee6018a61209b6ca`.
- Historical public release workflow: [run 37528076933](https://github.com/maximalcode/git-city/actions/runs/37528076933).
  - Release head: `f9eab0bba247ca2acf56dcd8fa2ce7838bb312b3` at tag `v0.9.1`.
  - Attempt 1, Windows job `112490080462`: failed.
  - Attempt 2, Windows job `112497773526`: passed.
- First native diagnostic run: [run 37816204192](https://github.com/maximalcode/git-city/actions/runs/37816204192).
- Second native diagnostic run: [run 37818368329](https://github.com/maximalcode/git-city/actions/runs/37818368329).

## Exact historical failure boundary

The failed release artifact records:

```text
Error: spawnSync python3 ETIMEDOUT
    at file:///D:/a/git-city/git-city/scripts/smoke-package.mjs:139:7
```

This is the outer Node `execFileSync` boundary around `python3 scripts/smoke-rehearse.py`; the source call sets `timeout: 180_000` in `scripts/smoke-package.mjs`. The failed artifact's separate `graceMs: 180000` value is the post-failure diagnostic observation window, not the Node timeout setting. The original artifact is `package-smoke-win32-x64`, artifact ID `11443786757`; the retry artifact ID is `11443699579`.

Phase 1 has not reproduced that exact outer `spawnSync python3 ETIMEDOUT` boundary. The native trace did observe a distinct inner Python `subprocess.TimeoutExpired` during `git-rehearse apply` in one replicate, so the two boundaries must remain separate in later analysis.

## Current observations

Local macOS ARM direct CLI observations were 9.073 s without the trace hook and 13.949 s with the trace hook. The trace adds work to the run, but these two observations do not isolate its overhead; they remain separate measurements and are not Windows timings.

The first native diagnostic run used an unpacked Electron package (`electron-builder --win --x64 --dir`) and three packaged-smoke restarts. Replicate 1 completed three runs in 96.063–97.699 s. Replicate 2 completed one run in 122.829 s; its second run stopped in Python with `TimeoutExpired` on Apply after 123.133 s. It did not reproduce the historical outer Node `ETIMEDOUT`.

The second native evidence run was dispatched before the workflow matrix was narrowed and contains four jobs: two CLI-only and two packaged. All six CLI-only passes completed in 12.724–14.635 s. The CLI-only path uses the same Python child and 180-second outer deadline, but does not launch Electron or run the packaged smoke; it is not equivalent to the packaged case. Packaged replicate 2 completed all three restarts in 47.238 s, 48.548 s and 50.897 s; its trace is retained at `/tmp/git-city-185-native-37818368329/windows-smoke-185-packaged-2`. Packaged replicate 1 remains pending.

The current workflow YAML runs two packaged replicates with the NSIS target used by the original release workflow. Each replicate runs a bundled CLI baseline before the packaged smoke and, when available, after it, using the same `dist/win-unpacked/resources/rehearse/git-rehearse.exe` binary. The pending result above is the packaged replicate 1 result from the second evidence run.

## Re-running

Run the diagnostic workflow from the diagnostic branch:

```bash
gh workflow run release.yml --ref codex/185-windows-smoke
gh run list --workflow release.yml
```

The current workflow matrix has `packaged` replicates 1 and 2. It builds with `electron-builder --win nsis --x64 --publish never`, runs three packaged-smoke restarts, and runs the bundled CLI harness before and after the smoke. Each job uploads its pre-smoke, packaged-smoke and post-smoke traces plus `test-results/package-smoke/` as `windows-smoke-185-packaged-<replicate>`.

On a native Windows PowerShell runner, prepare the app and run the exact bundled CLI baseline:

```powershell
npm ci
npm run tool:prepare -- win32-x64
npm run build
npx electron-builder --win nsis --x64 --publish never
$env:PYTHONPATH = "$pwd/scripts/diagnostics/185"
$env:GIT_CITY_185_TRACE = "$env:TEMP/git-city-185-pre.jsonl"
node scripts/diagnostics/185/direct-cli-harness.mjs `
  "dist/win-unpacked/resources/rehearse/git-rehearse.exe"
```

Run the packaged smoke with the same Python trace hook:

```powershell
$env:GIT_CITY_185_TRACE = "$env:TEMP/git-city-185-packaged.jsonl"
$env:GIT_CITY_SMOKE_RESTARTS = '3'
node scripts/smoke-package.mjs "dist/win-unpacked/GitCity.exe"
```

These commands require a native Windows runner; the packaged executable and bundled CLI are Windows binaries. The workflow uses the NSIS packaging path while launching the resulting unpacked directory.
