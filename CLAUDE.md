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
4. `npm run typecheck && npm run lint && npm test` — same three checks CI runs.
5. Open a PR **targeting `develop`** with `Closes #12` in the body.

`main` is release-only. It moves through `develop` → `main` PRs, and a release is
a `v*` tag matching `package.json` on top of that — see [RELEASING.md](RELEASING.md).
Both branches are protected: `main` requires a PR plus a green `ci` check,
`develop` blocks only deletion and force-push (direct pushes are fine there).

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
  - `store.ts` — zustand, the single state funnel between IPC and UI.
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
