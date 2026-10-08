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
- Third native paired-NSIS run: [run 37819590039](https://github.com/maximalcode/git-city/actions/runs/37819590039), head `3c3093c08310495495fc86c2940142b7b1820207`, executing.

## Exact historical failure boundary

The failed release artifact records:

```text
Error: spawnSync python3 ETIMEDOUT
    at file:///D:/a/git-city/git-city/scripts/smoke-package.mjs:139:7
```

This is the outer Node `execFileSync` boundary around `python3 scripts/smoke-rehearse.py`; the source call sets `timeout: 180_000` in `scripts/smoke-package.mjs`. The failed artifact's separate `graceMs: 180000` value is the post-failure diagnostic observation window, not the Node timeout setting. The original artifact is `package-smoke-win32-x64`, artifact ID `11443786757`; the retry artifact ID is `11443699579`.

Phase 1 has not reproduced that exact outer `spawnSync python3 ETIMEDOUT` boundary. The native trace did observe a distinct inner Python `subprocess.TimeoutExpired` during `git-rehearse apply` in one replicate, so the two boundaries must remain separate in later analysis.

## Current observations

The native ranges below are Python trace windows: each is the first traced subprocess start through the last traced subprocess end for that smoke run. They are not total packaged restart, job, or Node harness durations.

Local macOS ARM direct CLI observations were 9.072–9.073 s without the trace hook and 13.949 s with the trace hook, measured by the Node outer stopwatch. They are not the same metric as the Python trace windows. The trace adds work to the run, but these observations do not isolate its overhead and are not Windows timings.

The first native diagnostic run used an unpacked Electron package (`electron-builder --win --x64 --dir`) and three packaged-smoke restarts. Replicate 1 completed three Python trace windows in 96.063–97.699 s. Replicate 2 completed one Python trace window in 122.829 s; its second Python trace window was 162.051 s overall and stopped with `TimeoutExpired` on Apply after 123.133 s. It did not reproduce the historical outer Node `ETIMEDOUT`.

The second native evidence run was dispatched before the workflow matrix was narrowed and contains four jobs: two CLI-only and two packaged. All six CLI-only Python trace windows completed in 12.724–14.635 s. The CLI-only path uses the same Python child and 180-second outer deadline, but does not launch Electron or run the packaged smoke; it is not equivalent to the packaged case. All four jobs passed: packaged replicate 1 completed three Python trace windows in 142.207 s, 136.952 s and 104.406 s, and packaged replicate 2 completed three in 47.238 s, 48.548 s and 50.897 s. The downloaded traces are retained under `/tmp/git-city-185-native-37818368329/windows-smoke-185-packaged-1` and `/tmp/git-city-185-native-37818368329/windows-smoke-185-packaged-2`.

The third native paired-NSIS run has a completed replicate 2 and a pending replicate 1. For replicate 2, each trace contained 35 subprocesses: the pre-smoke bundled CLI baseline was 9.026 s, the three packaged-smoke windows were 50.542 s, 48.372 s and 46.111 s, and the post-smoke bundled CLI baseline was 7.837 s. All observed subprocesses completed without a timeout. The traces are retained under `/tmp/git-city-185-native-37819590039/windows-smoke-185-packaged-2`.

During the exact third-run replicate-2 Python windows, the Electron main-process diagnostic log recorded these Git and `gh` subprocesses:

| Python trace window (PID; UTC interval) | Git count / summed duration / max | `gh` count / summed duration / max |
| --- | ---: | ---: |
| 50.542 s (4628; 17:52:12.753–17:53:03.295) | 565 / 133.242 s / 0.867 s | 8 / 3.734 s / 0.582 s |
| 48.372 s (8892; 17:53:52.730–17:54:41.102) | 556 / 129.548 s / 0.892 s | 10 / 7.492 s / 1.826 s |
| 46.111 s (2808; 17:55:28.529–17:56:14.640) | 531 / 120.314 s / 0.958 s | 9 / 7.706 s / 2.450 s |

No main-process Git or `gh` entries fell inside the 9.026 s pre-smoke or 7.837 s post-smoke Python windows. Summed subprocess durations overlap when processes run concurrently; these are observations from the main diagnostic log, not causal claims. The paired before/after measurement reduces the separate-machine comparison confound, while adding a baseline warmup that may populate caches; prior processes may also survive best-effort shutdown unless that state is separately validated.

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
