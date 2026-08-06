<!--
Closes #<issue>   — every PR should close an issue; file one if it doesn't yet.
Target branch is `develop`. `main` is release-only.
-->

Closes #

## What this changes

<!-- What the reader will see differently, and why. The commit message can
     carry the detail; this is the summary someone reads before the diff. -->

## Checks

- [ ] `npm run typecheck && npm run lint && npm test` pass locally
- [ ] Docs updated in this PR, or nothing user-visible changed

<!--
The docs box is the one nothing else can catch — CI cannot tell whether prose
is true. If the change is user-visible, check:

  README.md         the feature lists (short and collapsed)
  docs/             troubleshooting, colour-modes, shortcuts
  docs/media/       stale if the scene looks different —
                    `node scripts/capture-media.mjs --stills`
  the numbers       repo-size table, timings, memory figures

See "Step 4, spelled out" in CLAUDE.md.
-->
