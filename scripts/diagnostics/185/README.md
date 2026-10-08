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
- Third native paired-NSIS run: [run 37819590039](https://github.com/maximalcode/git-city/actions/runs/37819590039), head `3c3093c08310495495fc86c2940142b7b1820207`, completed with both replicates passing.
- Controlled-stress run: [run 37821504345](https://github.com/maximalcode/git-city/actions/runs/37821504345), head `d72d3f0305fde1210675f0a68827e83281ff386b`, completed with inner merge failures in both packaged jobs. It kept two original packaged-smoke restarts and started bounded CPU stress after the first Python trace event, with up to three workers.
- Cancelled prior stress run: [run 37821372837](https://github.com/maximalcode/git-city/actions/runs/37821372837) used a misconfigured one-restart setting and contributes no experimental result count.
- Three-worker CLI stress run: [run 37822372809](https://github.com/maximalcode/git-city/actions/runs/37822372809), with both replicates passing.
- Two-worker packaged run: [run 37822784479](https://github.com/maximalcode/git-city/actions/runs/37822784479), with replicate 1 reproducing the outer error and the other replicate pending.
- Minimal pending packaged run: [run 37823758777](https://github.com/maximalcode/git-city/actions/runs/37823758777).
- Watch-stopped counterfactual run: [run 37825485112](https://github.com/maximalcode/git-city/actions/runs/37825485112), both packaged replicates passed after stopping the repository watcher immediately before Python smoke. The run used the synchronous `execFileSync` CLI driver and retained the same two-worker stress setting.

## Exact historical failure boundary

The failed release artifact records:

```text
Error: spawnSync python3 ETIMEDOUT
    at file:///D:/a/git-city/git-city/scripts/smoke-package.mjs:139:7
```

This is the outer Node `execFileSync` boundary around `python3 scripts/smoke-rehearse.py`; the source call sets `timeout: 180_000` in `scripts/smoke-package.mjs`. The failed artifact's separate `graceMs: 180000` value is the post-failure diagnostic observation window, not the Node timeout setting. The original artifact is `package-smoke-win32-x64`, artifact ID `11443786757`; the retry artifact ID is `11443699579`.

Phase 1 has now reproduced that exact outer `spawnSync python3 ETIMEDOUT` boundary under the controlled two-worker packaged run above. The historical cause is not established. The earlier native trace also observed a distinct inner Python `subprocess.TimeoutExpired` during `git-rehearse apply`; these boundaries remain separate observations.

## Current observations

The native ranges below are Python trace windows: each is the first traced subprocess start through the last traced subprocess end for that smoke run. They are not total packaged restart, job, or Node harness durations.

Local macOS ARM direct CLI observations were 9.072–9.073 s without the trace hook and 13.949 s with the trace hook, measured by the Node outer stopwatch. They are not the same metric as the Python trace windows. The trace adds work to the run, but these observations do not isolate its overhead and are not Windows timings.

The first native diagnostic run used an unpacked Electron package (`electron-builder --win --x64 --dir`) and three packaged-smoke restarts. Replicate 1 completed three Python trace windows in 96.063–97.699 s. Replicate 2 completed one Python trace window in 122.829 s; its second Python trace window was 162.051 s overall and stopped with `TimeoutExpired` on Apply after 123.133 s. It did not reproduce the historical outer Node `ETIMEDOUT`.

The second native evidence run was dispatched before the workflow matrix was narrowed and contains four jobs: two CLI-only and two packaged. All six CLI-only Python trace windows completed in 12.724–14.635 s. The CLI-only path uses the same Python child and 180-second outer deadline, but does not launch Electron or run the packaged smoke; it is not equivalent to the packaged case. All four jobs passed: packaged replicate 1 completed three Python trace windows in 142.207 s, 136.952 s and 104.406 s, and packaged replicate 2 completed three in 47.238 s, 48.548 s and 50.897 s. The downloaded traces are retained under `/tmp/git-city-185-native-37818368329/windows-smoke-185-packaged-1` and `/tmp/git-city-185-native-37818368329/windows-smoke-185-packaged-2`.

The third native paired-NSIS run completed both replicates. Each trace window contained 35 subprocesses, and all observed subprocesses completed without a timeout:

| Replicate | Pre-smoke bundled CLI | Packaged-smoke restart trace windows | Post-smoke bundled CLI |
| --- | ---: | --- | ---: |
| 1 | 14.353 s | 107.163 s, 127.841 s, 124.376 s | 13.737 s |
| 2 | 9.026 s | 50.542 s, 48.372 s, 46.111 s | 7.837 s |

These are Python trace windows, measured from the first traced subprocess start through the last traced subprocess end in each stage. The downloaded traces are retained under `/tmp/git-city-185-native-37819590039/windows-smoke-185-packaged-1` and `/tmp/git-city-185-native-37819590039/windows-smoke-185-packaged-2`.

Across the baseline native evidence, packaged smoke has 16 passing Python trace windows and one inner Python timeout in 17 attempts total. The standalone or bundled CLI baselines have 10 passing trace windows. The cancelled run, three-worker stress run, and later two-worker/minimal pending runs are excluded from these counts.

The two-worker packaged replicate 1 in run `37822784479` produced the exact outer error in `test-results/package-smoke/win32-0/original-error.json`:

```text
Error: spawnSync python3 ETIMEDOUT
    at file:///D:/a/git-city/git-city/scripts/smoke-package.mjs:139:7
```

Its Python trace has PID `2812`: the first event started at `2026-10-08T18:18:53.622794Z`; sequence 13 started `git-rehearse:merge` at `2026-10-08T18:19:12.268346Z` and has no end record. The available trace therefore shows the parent being terminated while inside `subprocess.run`; it does not establish that a Python 120-second timeout fired. The artifact is retained under `/tmp/git-city-185-native-37822784479/windows-smoke-185-packaged-1`.

Before that Python trace began, the packaged UI Apply assertions had already recorded target HEAD `da956a59f4a4796ce849466fe87e63c05f88ce85` and the expected `file.txt` SHA-256 `1af7d59532f1d6ae89bd4f57b6e4f7a45228d91217a44482957c6d7a5851de13` with 10 bytes. The retained IPC record reports `kind: applied`, `recoveryState: none`, and `durationMs: 68015`; the after-grace repository capture has the same HEAD/file/index hashes and clean status. The recorded executable path is the bundled `D:\a\git-city\git-city\dist\win-unpacked\resources\rehearse\git-rehearse.exe`, including the successful Rehearse CLI records, so these assertions refer to the same bundled binary path.

The preceding three-worker packaged stress run `37821504345` recorded inner `git-rehearse:merge` failures in both packaged jobs. The three-worker CLI stress run `37822372809` passed both replicates; its Node wrapper elapsed times were 18.520639 s and 20.023956 s, which are outer stopwatch values and not Python trace windows. Its artifacts are retained under `/tmp/git-city-185-native-37822372809`.

During the exact third-run replicate-2 Python windows, the Electron main-process diagnostic log recorded these Git and `gh` subprocesses:

| Python trace window (PID; UTC interval) | Git count / summed duration / max | `gh` count / summed duration / max |
| --- | ---: | ---: |
| 50.542 s (4628; 17:52:12.753–17:53:03.295) | 565 / 133.242 s / 0.867 s | 8 / 3.734 s / 0.582 s |
| 48.372 s (8892; 17:53:52.730–17:54:41.102) | 556 / 129.548 s / 0.892 s | 10 / 7.492 s / 1.826 s |
| 46.111 s (2808; 17:55:28.529–17:56:14.640) | 531 / 120.314 s / 0.958 s | 9 / 7.706 s / 2.450 s |

No main-process Git or `gh` entries fell inside the 9.026 s pre-smoke or 7.837 s post-smoke Python windows. Summed subprocess durations overlap when processes run concurrently; these are observations from the main diagnostic log, not causal claims. The paired before/after measurement reduces the separate-machine comparison confound, while adding a baseline warmup that may populate caches; prior processes may also survive best-effort shutdown unless that state is separately validated.

## Watcher pause counterfactual and feedback evidence

Run `37825485112` set `GIT_CITY_185_STOP_WATCH=1`. Both jobs logged `repository watcher stopped before Python smoke`, and each packaged smoke reported `cliDriver: "sync-execFileSync"` with `smoke: "passed"`. The Python trace windows were 57.697 s (replicate 1) and 85.914 s (replicate 2). These remain Python trace windows, not CLI or Node wrapper durations; the packaged app was still heavy with the watcher stopped.

The retained main-process `process-timing.json` records show the following. Counts in the first columns include `git`/`gh` children whose start timestamp fell inside the exact Python trace interval. The parenthetical overlap counts include children that started before the interval but were still running during it. Summed durations can overlap because children run concurrently.

| Run / replicate | Python trace span | Git started-in-window (overlap) | `gh` started-in-window (overlap) | Git summed duration / max | `gh` summed duration / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Watch stopped 37825485112 / 1 | 57.697 s | 1 (7) | 1 (1) | 0.188 s / 0.188 s | 0.919 s / 0.919 s |
| Watch stopped 37825485112 / 2 | 85.914 s | 1 (7) | 1 (1) | 0.336 s / 0.336 s | 3.198 s / 3.198 s |
| Minimal active watcher 37823758777 / 1 | 121.033 s | 579 (582) | 20 (20) | 692.031 s / 4.034 s | 121.906 s / 11.243 s |
| Minimal active watcher 37823758777 / 2 | 98.634 s | 528 (535) | 22 (22) | 503.893 s / 1.907 s | 114.009 s / 6.431 s |

The stopped-watcher interval's one in-window Git call was `remote get-url origin` and its one `gh` call was `auth status`. The overlap-only Git records were the repo-open batch that began just before the Python interval, including `submodule status`, branch refs, stash list, and tags. The active-watcher minimal run repeatedly started the normal status/branch/stash/tag batch and `gh auth status` during the Python interval. This is an observational comparison of the recorded process timings, not a causal claim about every historical process.

The source and local runtime evidence now support this specific feedback chain: Git City invokes plain `git status` without `--no-optional-locks`; Git's [official `git status` background-refresh documentation](https://git-scm.com/docs/git-status#_background_refresh) says that status refreshes and writes the index by default; the native fixture probe observed raw `.git/index.lock` renames from real `fs.watch`; and the production watcher classifies any top-level Git-directory filename other than exact `HEAD` or `index` as `refs` ([`watcher.ts:44-50`](../../../src/main/git/watcher.ts:44)). In the feedback run, a real `getWorkingStatus` invoked in response to `worktree` produced repeated raw `index.lock` renames and production `refs` events while index mtime stayed unchanged; the no-status control produced no repeats. Raw probe output is retained at `/tmp/git-city-185-watcher-feedback.log`, with the temporary probe at `scripts/diagnostics/185/watcher-feedback.test.ts` pending conversion into a regression test.

The watcher-stop Windows counterfactual removes that repeated watcher path before Python and sharply reduces in-window main Git/`gh` starts while both packaged runs pass. The historical active command remains unknown; this evidence matches the outer-fault timing and supports H1 as a tested explanation path, but does not prove that the historical failure was caused by this exact command sequence. The synchronous Node driver, main-process tracing overhead, and other hypotheses remain untested by this counterfactual alone.

## Re-running

Run the diagnostic workflow from the diagnostic branch:

```bash
gh workflow run release.yml --ref codex/185-windows-smoke
gh run list --workflow release.yml
```

The current workflow matrix has `packaged` replicates 1 and 2. It builds with `electron-builder --win nsis --x64 --publish never`, runs two stressed packaged-smoke restarts, and runs the bundled CLI harness before and after the smoke. The stress harness starts bounded CPU pressure after the first Python trace event, capped at three workers. Each job uploads its pre-smoke, foreground packaged-smoke and post-smoke traces plus `test-results/package-smoke/` as `windows-smoke-185-packaged-<replicate>`.

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

Run the current two-restart packaged smoke with bounded CPU stress:

```powershell
$env:GIT_CITY_185_TRACE = "$env:TEMP/git-city-185-foreground.jsonl"
$env:GIT_CITY_SMOKE_RESTARTS = '2'
$env:GIT_CITY_185_STRESS_WORKERS = '3'
node scripts/diagnostics/185/stress-packaged-harness.mjs `
  "dist/win-unpacked/GitCity.exe"
```

These commands require a native Windows runner; the packaged executable and bundled CLI are Windows binaries. The workflow uses the NSIS packaging path while launching the resulting unpacked directory.
