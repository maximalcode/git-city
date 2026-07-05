# Git City

Watch your git repository come alive as a 3D city. Folders become districts,
files become buildings — height is lines of code — and a timeline lets you
scrub through the project's history and watch the city grow.

![icon](build/icon.png)

## How it works

Git City runs one streaming pass of
`git log --first-parent --reverse --no-renames --raw --numstat` over the repo.
Along first-parent history the diffs telescope, so cumulatively applying each
commit's added/deleted line counts reproduces the exact line count of every
file at every mainline commit — no checkouts, no per-file git calls. ~50 evenly
spaced snapshots feed the timeline; the treemap city layout is computed once
over every file that ever existed, so buildings rise, shrink and vanish but
never move while you scrub.

## Development

```bash
npm install
npm run dev        # launch the Electron app with hot reload
npm test           # vitest: treemap layout + git history replay
npm run typecheck
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

- `src/main/` — Electron main process: window, IPC, git analysis
  (`git/analyze.ts` is the history replay engine, `git/clone.ts` clones URLs
  into the app's cache dir).
- `src/preload/` — typed `window.gitCity` bridge.
- `src/renderer/` — React + react-three-fiber UI. `layout/treemap.ts` is the
  squarified treemap (pure, unit-tested), `city/` renders instanced buildings,
  district plates, highlights and the HUD.
- `src/shared/types.ts` — types shared across all three.

Note: the app intentionally avoids `@react-three/drei` — we only needed
MapControls (see `city/CameraControls.tsx`), and drei's text stack embeds a
base64 WASM blob that antivirus heuristics love to false-positive on.
