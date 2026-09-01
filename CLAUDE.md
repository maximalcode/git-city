# Git City — working notes

Electron desktop app that renders a git repository as a 3D city (or farm) and
puts a full git client on top of it. React 19 + react-three-fiber for the scene,
zustand for state, git driven by raw `spawn` in the Electron main process.

## How we work: issues first

**Every unit of work starts as a GitHub issue.** Not a TODO comment, not a
scratch file, not a note in a chat — an issue. If something worth doing turns up
mid-task, file it (`gh issue create`) and keep going.

```bash
gh issue list                      # what's open
gh issue list --milestone "Public launch"
gh issue create --title "..." --body "..."
gh issue view 12
```

The loop for a piece of work:

1. Pick an issue (or file one).
2. Branch from `develop`: `git checkout develop && git pull && git checkout -b feat/12-farm-mode`
   — naming is `<type>/<issue-number>-<slug>` with type one of
   `feat` / `fix` / `refactor` / `docs` / `infra` / `chore`.
3. Build it. Reference the issue in commit messages (`#12`).
4. **Update the docs in the same PR.** If the change is user-visible, it is not
   finished until the prose says so — see below.
5. `npm run typecheck && npm run lint && npm test` — same three checks CI runs.
6. Open a PR **targeting `develop`** with `Closes #12` in the body.

`main` is release-only. It moves through `develop` → `main` PRs, and a release is
a `v*` tag matching `package.json` on top of that — see [RELEASING.md](RELEASING.md).
Both branches are protected: `main` requires a PR plus a green `ci` check,
`develop` blocks only deletion and force-push (direct pushes are fine there).

### Step 4, spelled out

Nothing in CI can check whether prose is accurate, so this step is the only
thing standing between the app and a README that describes an older version of
it. It has failed before: the farm shipped night lighting, tractors and motion
across three PRs and the README described none of them (#87).

A user-visible change means: something you could screenshot, something a user
could press, or a number a user might rely on. For those, check —

- **[README.md](README.md)** — the pitch, shown with pictures. Only headline
  capabilities earn a section there.
- **[docs/features.md](docs/features.md)** — the complete inventory. Every new
  capability goes here, whether or not it is headline-worthy.
- **`docs/`** — [troubleshooting](docs/troubleshooting.md),
  [colour-modes](docs/colour-modes.md), [shortcuts](docs/shortcuts.md). A new
  key binding belongs in the README table _and_ the shortcuts page.
- **`docs/media/`** — if the scene looks different, the screenshots are now
  wrong. Every image in the README is `app-*`, captured from the real app on
  this repository: `npm run media:app`, or `-- --only=<name>` for one. It needs
  a current `npm run build`, since it launches `out/main/index.js`.
  `npm run media` is the older browser-preview capture against synthetic data —
  deterministic, and still the right tool for scene work, but its output is not
  what the README shows.
- **Measured numbers** — the repo-size table and timings in the README are
  claims. If you remeasured, update them; if you made something faster or
  smaller, say so with the figure.

Write it as part of the change, not as a follow-up PR. Docs landing separately
(`docs/41-align-with-25`, `docs/release-artifact-names`) is the symptom this
step exists to stop.

`.github/pull_request_template.md` asks the same question at the moment the PR
is opened, so the answer has to be given rather than remembered.

## Commands

```bash
npm run dev        # Electron app with hot reload (needs git on PATH)
npm test           # vitest — git backend, parsers, layout, themes
npm run typecheck  # tsc over both tsconfigs (node + web)
npm run lint       # ESLint (typescript-eslint + react-hooks)
npm run format     # Prettier
npm run test:e2e   # Playwright (not in CI yet)

npx vite -c vite.preview.config.ts   # browser-only renderer preview, port 5199
                                     # open /?mock for a synthetic 250-file repo
```

The preview is the fast path for anything visual: no Electron, no real repo, both
view modes fully explorable with deterministic mock data.

## Architecture

- **`src/main/`** — Electron main process. `git/analyze.ts` is the history replay
  engine (one streaming `git log --first-parent --reverse --raw --numstat` pass;
  line counts telescope so every file's size at every commit falls out without
  checkouts). `git/` is one module per concern — `status`, `stage`, `commit`,
  `sync`, `branches`, `merge`, `conflicts`, `stash`, `tags`, `diff`, `history`,
  `graph`, `search`, `signing`, `submodules`, `worktrees`, `github`,
  `rebaseInteractive`. Raw `spawn` everywhere except fetch/pull/push (simple-git,
  for progress + abort). Errors come back as a uniform `OpResult`; a per-repo lock
  in `queue.ts` keeps two of our own commands from racing for `index.lock`.
- **`src/preload/`** — the typed `window.gitCity` bridge.
- **`src/renderer/src/`**
  - `layout/` — pure, unit-tested scene math: `treemap.ts` (squarified treemap →
    plots, districts, roads), `roads.ts` (street graph), `farm.ts` (farm model).
    No three.js imports here. This is the abstraction a new view mode reuses.
  - `city/` — the 3D scene. `SceneView.tsx` is the mode-agnostic shell (canvas,
    camera rig, effects, HUD) that mounts the active mode from the `modes.tsx`
    registry — adding a view mode is one entry there plus its scene.
    `themes.ts` is a data-driven registry — "adding a look = adding an entry".
    `colorModes.ts` handles the six colour encodings.
  - `panels/` — the git client UI. `screens/` — welcome and repo-open flows.
  - `store.ts` — zustand, the funnel for everything that **changes** the repo.
    An op goes through `runOp`, which runs it, resyncs, and **returns its
    `OpResult`** — callers ask the result whether it worked, never the `opError`
    field. `resync()` owns "the repo changed, reload what that invalidated":
    the view list lives in `REPO_VIEWS`, so adding a view is one entry, not a
    line in four places (#107).
  - `lib/repoQuery.ts` — the funnel for everything that **reads** it.
    `useRepoQuery(args, read)` owns cancellation, `cleanError`, loading/error
    state and `reload()`; `args` is both what `read` is called with and the key
    that decides when the answer went stale, so a staleness trigger that isn't
    an argument (HEAD's hash, the working-tree fingerprint) is declared by
    putting it in the tuple. Panels don't hand-roll read effects (#106).
  - `lib/bridge.ts` — the only place that touches `window.gitCity`. `setBridge()`
    injects a fake, which is what makes any of this testable off Electron.
- **`src/shared/types.ts`** — the `GitCityApi` contract shared across all three.

Contract-first: when adding a capability, land `shared/types.ts` + the IPC handler
first, then the renderer side.

## Standing constraints

- **No new runtime dependencies.** `simple-git` is the only one; everything else
  is a devDependency bundled at build time. Node `fetch`, Electron APIs and git
  shell-outs have covered every feature so far.
- **No `@react-three/drei`** — we only ever needed MapControls (see
  `city/CameraRig.tsx`), and drei's text stack embeds a base64 WASM blob that
  antivirus heuristics false-positive on. All vehicle and tree geometry is built
  in-code from merged three.js primitives.
- **Force-push is deliberately not implemented.** Neither is auto-merge.
- Instanced meshes + explicit GPU dispose for anything in the 3D scene.
- Pure logic gets its own module and unit tests; 3D components stay thin.
- No telemetry, no token storage (PRs go through the `gh` CLI), signing keys stay
  with gpg-agent / ssh-agent.

## Docs

- [README.md](README.md) — the public pitch and feature list.
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup and PR flow for outside contributors.
- [RELEASING.md](RELEASING.md) — cutting a release, code signing, macOS notes.
- [docs/roadmap-git-parity.md](docs/roadmap-git-parity.md) — historical record of
  the v9–v12 milestones (all shipped). Live planning happens in issues now.

## Agent skills

### Issue tracker

Before issue operations, read `docs/agents/issue-tracker.md` for the GitHub workflow.

### Triage labels

Before triage, read `docs/agents/triage-labels.md` for the role-to-label mapping.

### Domain docs

Before codebase exploration, read `docs/agents/domain.md` for this repo's
single-context documentation conventions.

### Sub-agent model tiers

Before spawning a stage with a named tier, read `docs/agents/subagents.md` and
apply its explicit Codex model and reasoning settings. Fresh-context spawning
is confirmed.

<!-- BEGIN maxi-quality agent-guard sha256:1f0a94506e51e28d -->

## The gate, and how a session ends

This repo's quality baseline is enforced by two hooks and one deny rule in
`.claude/settings.json`. They are not advice — they refuse.

**Run the gate through the recorder, not directly:**

```bash
python3 .claude/agent-guard/record-gate.py --gate
```

`--gate` runs the command this repo declares in `.claude/agent-guard.json`,
whole and through one shell, so a gate written as `a && b` is recorded as a
gate rather than as its first half. It passes the gate's exit code straight
through. (`-- <command>` still works for an ad-hoc run, and is what you want
when the thing you are running is not the declared gate.)

A session cannot end while the working tree holds changes the gate has not
seen. If it refuses, the message says which of the four cases you are in: never
ran, ran and failed, ran something that was not this repo's gate, or ran against
different content.

**Do not write `.claude/agent-guard-receipt.json` by hand.** The `Edit` tool is
refused on it — that is a deny rule in `.claude/settings.json`, not advice. A
shell command still reaches the file, and nothing downstream can tell: it is
the gate's own input, so a hand-written one passes. It is the single action
here that turns a guard into a lie.

**Do not pass `--no-verify` to `git commit` or `git push`.** That is refused
too. It switches off this repo's commit hook, which is the last check before
content the gate has not seen becomes a commit. If the hook is failing for a
reason that is not your change, say so — do not route around it.


<!-- END maxi-quality agent-guard -->
