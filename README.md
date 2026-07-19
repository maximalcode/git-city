# Git City

Watch your git repository come alive as a 3D city — and work in it. Folders
become districts, files become buildings (height = lines of code), a timeline
scrubs through history while the city grows, and a full git client lives on
top: stage, commit, fetch, pull, push, branch, merge, rebase, stash,
cherry-pick and tag without leaving the city.

Prefer something calmer? Press `V` and the same repository becomes a **forest**:
every file a tree in its folder's grove, canopies growing and shrinking with
the line count as you scrub through history.

![icon](build/icon.png)

## Features

**Visualization**

- **Two view modes** (`V` to switch, persisted): the 3D **City** and the
  **Forest**
- City: districts per folder, buildings per file, real streets with raised
  sidewalks, curbs and zebra crossings; commit-weighted traffic driving on
  them (cars and bikes — hover-craft in Neon); lamp posts and street trees
  lining the roads with a belt of greenery around the city; ground-floor
  shopfront glow on tall buildings in night themes
- Forest: every file is a tree (bush / tree / ancient by size) standing in its
  folder's grove; canopies grow in and breathe with the live line count and
  colour by the active colour mode; a gentle wind sway keeps it alive
- Timeline playback: scrub or play the entire history (a full replay fits in
  ~10 seconds)
- 5 themes (Realistic Day/Night, Neon, Golden Hour, Midnight Ink) with
  procedural lit windows, sky gradients and ambient occlusion
- 6 color modes — language, activity, author, recency, size, file type — each
  with an always-visible legend explaining the encoding, identical in both
  view modes
- Camera fly-to on selection, cinematic intro orbit
- **Command palette** (`Ctrl`/`Cmd`+`K`): fuzzy-search every action and jump to
  any file (camera flies there), switch branch, pop a stash, change view / theme
  / colour — all from one box. Two search modes by leading sigil: **`@`** searches
  **commits** (message / author / hash, across all refs) and **`:`** searches
  **code** in tracked files (`git grep`). A commit hit opens a detail panel
  (signature state, changed files → diff, cherry-pick, fly-to) that works for
  _any_ commit, not just the sampled ones
- **Orientation minimap** with a compass marker tracking the camera, so big
  repos never lose you (north up)
- **Time-of-day** control decoupled from the theme — drag the sun from night
  through noon to dusk; the key light and shadows move with it
- **Activity hotspots**: the files churning most this week pulse with a glowing
  beacon over their rooftop / canopy
- **First-run guide** explaining the height / colour / shape encoding, re-openable
  any time from the `?` button
- Hover any file for a cursor-following tooltip (language, size, commits, last
  author + date); **double-click** it to jump straight into its diff
- A **now-playing** commit banner during history playback (message, author, date)

**Git client**

- Working-tree status overlaid on the city; stage/unstage/discard, commit
  (+ amend). Expand any changed file to **stage, unstage or discard
  individual hunks** (`git add -p`, but visual)
- Fetch / pull / push with progress and cancel — **force-push does not exist
  in this app, by design**
- Branches (incl. remote-tracking), merge, rebase, cherry-pick, stashes, tags
- **Submodules** (status + one-click update) and **worktrees** (list, open,
  remove) surfaced in the Branches panel
- **Commit signing**: a "Sign" toggle in the commit box (defaults to the repo's
  `commit.gpgsign`), and a verified/unverified badge on commits — keys stay with
  gpg-agent / ssh-agent, never handled by the app
- Interactive rebase editor (reorder / squash / drop) — local history only
- In-app merge-conflict resolver (ours / theirs / both / edit per hunk)
- **Time machine (reflog):** one-click Undo of the last HEAD move (keeps your
  uncommitted work and is itself undoable), plus a panel of every past HEAD
  position — rewind the branch to any of them, or recover a "lost" commit as a
  new branch. Local refs only; never force-pushes.
- Per-file diff viewer — **unified or side-by-side** (toggle, persisted) with
  **word-level intra-line highlighting** — plus file history (follows renames)
  and blame
- Commit graph with branch topology, ref chips, checkout/cherry-pick actions
- **Pull requests** (GitHub, via the `gh` CLI — no token setup): list open PRs
  with rolled-up CI status, see the current branch's PR, check one out, open it
  in the browser, or create a PR for the current branch. Falls back to a clear
  hint when `gh` is missing or logged out
- **Fresh repos welcome**: open a repository with no commits yet (a brand-new
  `git init`) and make the first commit from inside Git City — the city grows
  the moment you do. Detached HEAD is labelled clearly and a missing `git`
  install is explained on the welcome screen
- Recent repos, drag-drop a folder to open, file search with fly-to

**Keyboard shortcuts**

| Key              | Action                         |
| ---------------- | ------------------------------ |
| `Ctrl`/`Cmd`+`K` | Command palette                |
| `C`              | Changes panel                  |
| `B`              | Branches panel                 |
| `S`              | Stashes panel                  |
| `G`              | Commit graph                   |
| `U`              | Time machine (reflog undo)     |
| `P`              | Pull requests                  |
| `V`              | Toggle City / Forest view      |
| `/`              | Find a file (arrows + Enter)   |
| `Space`          | Play/pause the timeline        |
| `Escape`         | Close panels / clear selection |

## How it works

Git City runs one streaming pass of
`git log --first-parent --reverse --no-renames --raw --numstat` over the repo.
Along first-parent history the diffs telescope, so cumulatively applying each
commit's added/deleted line counts reproduces the exact line count of every
file at every mainline commit — no checkouts, no per-file git calls. ~50 evenly
spaced snapshots feed the timeline; the treemap city layout is computed once
over every file that ever existed, so buildings rise, shrink and vanish but
never move while you scrub.

Git operations run in the Electron main process through a per-repo lock (two
of our own commands never race for `index.lock`), with a file watcher that
keeps the UI live and mutes itself during operations.

## Development

```bash
npm install
npm run dev        # launch the Electron app with hot reload
npm test           # vitest: git backend, parsers, layout, themes (~240 tests)
npm run typecheck
npm run lint       # ESLint (typescript-eslint + react-hooks)
npm run format     # Prettier
```

`npm run dev` requires git on your PATH (the app shells out to it).

There is also a browser-only preview of the renderer for quick visual work
(no Electron, no git). Open `http://localhost:5199/?mock` for a deterministic
synthetic repo (250 files, 30 snapshots) with fake working-tree status — both
view modes fully explorable:

```bash
npx vite -c vite.preview.config.ts
```

## Packaging

```bash
npm run dist:win   # NSIS installer → dist/ (build on Windows)
npm run dist:mac   # DMG → dist/ (must be built on a Mac)
```

The app icon is generated procedurally: `node scripts/make-icon.js`.

Installers are unsigned, so Windows SmartScreen / macOS Gatekeeper will warn
on first launch. For real distribution add code signing (a Windows code
signing cert / Apple Developer ID + notarization).

## Architecture

- `src/main/` — Electron main process: window, IPC, git analysis and the git
  op backend. `git/analyze.ts` is the history replay engine; `git/` holds one
  module per concern (status, stage, commit, sync, branches, merge, conflicts,
  stash, tags, diff, history, graph, interactive rebase) — raw `spawn`
  everywhere except fetch/pull/push, which use simple-git for progress +
  abort. Errors surface as a uniform `OpResult`; read-only IPC channels never
  leak raw git stderr to the renderer.
- `src/preload/` — typed `window.gitCity` bridge.
- `src/renderer/` — React + react-three-fiber UI. `layout/` holds the pure,
  unit-tested scene math: the squarified treemap, the street graph derived
  from it, and the forest layout. `city/` renders both scenes (instanced
  buildings, district plates, streets with sidewalks, traffic, street furniture,
  trees, effects) behind a mode-agnostic `SceneView` shell; `panels/` holds the
  git client UI; `store.ts` (zustand) is the single state funnel.
- `src/shared/types.ts` — types shared across all three.

Note: the app intentionally avoids `@react-three/drei` — we only needed
MapControls (see `city/CameraRig.tsx`), and drei's text stack embeds a
base64 WASM blob that antivirus heuristics love to false-positive on. All
vehicle and tree geometry is likewise built in-code from merged three.js
primitives, no external models.
