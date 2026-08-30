# Contributing to Git City

Thanks for taking a look. This is a small project with a simple workflow.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Start with an issue

Every change starts as a GitHub issue — bug reports, features, refactors, chores.
Open one before you write code so the approach can be agreed on first; that saves
you from building something that gets turned down at review.

Browse [open issues](https://github.com/maximalcode/git-city/issues) to find
something to pick up.

## Setup

You need **Node 22+** and **git on your PATH** (the app shells out to git).

```bash
npm ci
npm run dev        # launch the Electron app with hot reload
```

For quick visual work on the 3D scene there is a browser-only preview with a
synthetic repo — no Electron, no git needed:

```bash
npx vite -c vite.preview.config.ts   # then open http://localhost:5199/?mock
```

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm test
npm run format     # Prettier
```

CI runs the first three on every push and pull request, so running them locally
just saves you a round trip.

Then update the docs, in the same pull request. If your change is user-visible —
something you could screenshot, something a user could press, or a number a user
might rely on — it belongs in [README.md](README.md)'s feature list and in
whichever `docs/` page covers it. If the scene looks different, the screenshots
in `docs/media/` are now wrong; regenerate them from the browser preview with
`node scripts/capture-media.mjs --stills` rather than cropping by hand.

No check can verify prose, which is exactly why it is written down here.

## Branches and pull requests

- `develop` is the working branch. Branch from it, and target your pull request
  at it.
- `main` is release-only. It moves through `develop` → `main` pull requests, and
  a release is a version tag on top (see [RELEASING.md](RELEASING.md)).
- Name branches `<type>/<issue-number>-<slug>`, e.g. `feat/12-farm-mode`,
  `fix/31-diff-scroll`.
- Put `Closes #12` in the pull request body so the issue closes on merge.

## Project conventions

A few standing constraints worth knowing before you add code:

- **No new runtime dependencies.** `simple-git` is the only one. Node's `fetch`,
  Electron APIs and shelling out to git cover the rest.
- **No `@react-three/drei`.** All geometry is built in-code from merged three.js
  primitives. See the note at the bottom of the [README](README.md#architecture).
- **Force-push does not exist in this app, by design.**
- Pure logic (layout math, parsers, diff algorithms) lives in its own module and
  gets unit tests. 3D components stay thin.

[CLAUDE.md](CLAUDE.md) has a fuller tour of the architecture.
