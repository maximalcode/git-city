# Git City

Watch your git repository come alive as a 3D city — and work in it. Folders
become districts, files become buildings (height = lines of code), a timeline
scrubs through history while the city grows, and a full git client lives on
top: stage, commit, fetch, pull, push, branch, merge, rebase, stash,
cherry-pick and tag without leaving the city.

![icon](build/icon.png)

## Features

**Visualization**

- 3D city built from your repo: districts per folder, buildings per file,
  activity-weighted street traffic (cars, people, bikes — hover-craft in Neon)
- Timeline playback: scrub or play through the entire commit history
- 5 themes (Realistic Day/Night, Neon, Golden Hour, Midnight Ink) with
  procedural lit windows, sky gradients and ambient occlusion
- 6 color modes — language, activity, author, recency, size, file type — each
  with an always-visible legend explaining the encoding
- Camera fly-to on selection, cinematic intro orbit

**Git client**

- Working-tree status overlaid on the city; stage/unstage/discard, commit
  (+ amend)
- Fetch / pull / push with progress and cancel — **force-push does not exist
  in this app, by design**
- Branches (incl. remote-tracking), merge, rebase, cherry-pick, stashes, tags
- Interactive rebase editor (reorder / squash / drop) — local history only
- In-app merge-conflict resolver (ours / theirs / both / edit per hunk)
- Per-file diff viewer, file history (follows renames) and blame
- Commit graph with branch topology, ref chips, checkout/cherry-pick actions
- Recent repos, drag-drop a folder to open, file search with fly-to

**Keyboard shortcuts**

| Key      | Action                         |
| -------- | ------------------------------ |
| `C`      | Changes panel                  |
| `B`      | Branches panel                 |
| `S`      | Stashes panel                  |
| `G`      | Commit graph                   |
| `/`      | Find a file (arrows + Enter)   |
| `Space`  | Play/pause the timeline        |
| `Escape` | Close panels / clear selection |

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
npm test           # vitest: git backend, parsers, layout, themes (~130 tests)
npm run typecheck
npm run lint       # ESLint (typescript-eslint + react-hooks)
npm run format     # Prettier
```

`npm run dev` requires git on your PATH (the app shells out to it).

There is also a browser-only preview of the renderer for quick visual work
(no Electron, no git — inject mock data or look at the welcome screen):

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
- `src/renderer/` — React + react-three-fiber UI. `layout/treemap.ts` is the
  squarified treemap (pure, unit-tested), `city/` renders instanced buildings,
  district plates, traffic, effects and the HUD; `panels/` holds the git
  client UI; `store.ts` (zustand) is the single state funnel.
- `src/shared/types.ts` — types shared across all three.

Note: the app intentionally avoids `@react-three/drei` — we only needed
MapControls (see `city/CameraControls.tsx`), and drei's text stack embeds a
base64 WASM blob that antivirus heuristics love to false-positive on.
