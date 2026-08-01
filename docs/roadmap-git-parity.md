# Git City — Roadmap: closing the gap to the top-tier git clients

> **Status: all four milestones shipped.** v9 (PR #10), v10 (#11), v11 (#12) and
> v12 (#13) are merged, and development has continued past them through v19. The
> one deliberate leftover is **v12c, the GitLab provider** — tracked as an issue.
> This file is kept as the historical design record; live planning now happens in
> [GitHub Issues](https://github.com/maximalcode/git-city/issues).

Dedicated plan for the four prioritized gaps identified against GitKraken / Tower /
Fork / Sublime Merge / GitHub Desktop (2026):

1. Hosting / Pull-Request integration
2. Commit search + content search
3. Diff: side-by-side + word-level
4. Commit signing + submodules + worktrees

Each is its own milestone / PR, stacked in the recommended order. All work honours
the standing constraints: **no new runtime deps** (Node `fetch` + Electron
`safeStorage` cover PR auth; `simple-git`/git shell-outs cover the rest), **no
force-push**, InstancedMesh + GPU-dispose discipline for any 3D touch, pure-logic
modules unit-tested, preview + e2e + exe rebuild before each PR merges.

Architecture recap (so each task lands in the right layer):
`src/main/git/*.ts` (git logic) → IPC handlers → `GitCityApi` in
`src/shared/types.ts` (the contract) → preload bridge (`window.gitCity`) →
`store.ts` actions → panels / HUD / 3D scene.

---

## Recommended sequence

| Order   | Milestone                           | Why first                                                                             | Rough size |
| ------- | ----------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| **v9**  | #2 Commit + content search          | Highest daily value, self-contained, the Command Palette is already the perfect stage | M          |
| **v10** | #4 Diff side-by-side + word-level   | Immediately visible quality win, pure-logic core                                      | M          |
| **v11** | #5 Signing + submodules + worktrees | Pro "checkbox" features; three independent slices                                     | M–L        |
| **v12** | #1 Hosting / PR integration         | Biggest lift + only one needing network/secret handling; do last                      | L          |

Do them as four separate stacked PRs (like v6→v7→v8). Each merges to `main` on its own.

---

## v9 — Commit search + content search (gap #2)

**Goal:** find any commit (by message / author / hash) or any code (by content),
Sublime-Merge style, from the Command Palette — decoupled from the 50-snapshot
sampling so _every_ commit is reachable.

- **Backend** `src/main/git/search.ts`:
  - `searchCommits(repo, query, opts)` → shells `git log --all` with the right flag:
    `--grep` (message), `--author`, `-S`/`-G` (pickaxe = content add/remove), `-- <path>`,
    or `git show` when the query looks like a hash. Returns `CommitHit[]`
    (`{hash, shortHash, author, date, subject, matchKind}`), capped + `truncated`.
  - `grepWorkingTree(repo, query)` → `git grep -n -I --max-count` over tracked files →
    `GrepHit[]` (`{path, line, text}`).
  - Reuse the existing log-parsing helpers; add a tiny pure-logic `parseQuery` (detect
    hash vs `author:` vs `path:` prefixes vs free text) — **unit-tested**.
- **Contract:** add `searchCommits` + `grepWorkingTree` to `GitCityApi` + IPC handlers.
- **Store:** `commitHits`, `grepHits`, `searchCommits(q)` (debounced), `openCommit(hash)`.
- **UI:** extend `CommandPalette` with scoped modes — free text still matches
  actions/files; `@` → commits, `:` → content (or a segmented toggle). New
  `CommitDetail` panel (message, author, signature badge, changed-file list, diff via
  the existing `getFileDiff(rev)`), with **Cherry-pick / Checkout / Copy hash**.
  Selecting a commit opens `CommitDetail` — no dependency on whether that commit is a
  sampled snapshot; if it _is_ sampled, also offer "Fly the city to this commit".
- **3D (optional):** a content-grep hit can fly-to + pulse the owning building.
- **Tests:** `search.parseQuery` (hash/author/path/text), result ranking, empty/limit.
- **Risks:** `--all` on huge repos → always cap + show `truncated`; `git grep` binary
  files excluded via `-I`.

## v10 — Diff: side-by-side + word-level (gap #4)

**Goal:** the diff reads like Fork/Sublime — intra-line word highlighting and an
optional two-column view; image diffs for binary images.

- **Pure-logic** `src/renderer/src/lib/wordDiff.ts`:
  - `wordDiff(oldLine, newLine)` → token spans `{text, kind: 'same'|'del'|'add'}` via a
    small Myers/LCS over word tokens. **Unit-tested** (identical, insert, replace, empty).
  - `toSideBySide(hunk)` → rows `{left, right, leftKind, rightKind}` pairing del/add,
    context on both sides. **Unit-tested** (counts, alignment, pure add/del hunks).
- **UI** `DiffPanel`:
  - View toggle **Unified ⇄ Split** (persisted like theme); split renders two aligned
    columns; both views render del/add lines with word-level `<span>` highlight.
  - **Image diff:** when the file is a known image ext + binary, fetch old/new blobs as
    base64 and show them side by side with a size delta.
- **Backend (only for image diff):** `getBlob(repo, rev, path)` → base64 (`git show
rev:path`), or reuse an existing blob path if present. Add to `GitCityApi`.
- **Tests:** `wordDiff`, `toSideBySide`. (Rendering verified in preview.)
- **Risks:** giant lines → cap word-diff length, fall back to line-level; images capped
  by size before base64.

## v11 — Signing + submodules + worktrees (gap #5)

Three independent slices; ship as three commits in one PR.

- **Commit signing (GPG/SSH):**
  - Read `commit.gpgsign` / `gpg.format` / `user.signingkey` to default a **"Sign"**
    toggle in the commit box; pass `-S` / `--no-gpg-sign` to `commit()`.
  - Parse `%G?` in log → verification state; show a **Verified / Unverified** badge in
    `CommitDetail` and the commit graph. Backend: extend commit + log parsing.
  - We never touch keys — gpg-agent/ssh-agent do; git errors surface via the existing
    `OpResult` path.
- **Submodules** `src/main/git/submodules.ts`:
  - `listSubmodules(repo)` → `git submodule status` → `{path, sha, branch, state}`.
  - `updateSubmodules(repo, path?)` → `git submodule update --init --recursive`.
  - UI: a **Submodules** section in the Branches panel; "open as repo" reuses `openPath`.
  - 3D (optional): submodule dirs get a distinct district marker + legend entry.
- **Worktrees** `src/main/git/worktrees.ts`:
  - `listWorktrees(repo)` → `git worktree list --porcelain` → `{path, head, branch,
locked}`; `addWorktree`, `removeWorktree`.
  - UI: a **Worktrees** section atop the Branches panel (GitKraken-style); "switch" opens
    that path via the existing repo-open flow.
- **Contract:** add the six calls to `GitCityApi` + IPC; **Command Palette** entries for
  each (create/switch worktree, update submodules, toggle signing).
- **Tests:** porcelain parsers for `worktree list` + `submodule status` (pure-logic).
- **Risks:** worktree/submodule state is read-mostly; destructive `remove` goes through
  the existing confirm dialog.

## v12 — Hosting / Pull-Request integration (gap #1)

**Goal:** stop bouncing to the browser — list/create/checkout PRs and see CI status
inside Git City. GitHub first; GitLab behind the same provider interface later.

- **Auth (no new dep):** prefer `gh auth token` (zero setup if the GitHub CLI is
  installed); fall back to a **PAT** the user pastes, stored encrypted via Electron
  `safeStorage` (OS keychain). Token lives only in the main process, never in a URL,
  never in the renderer.
- **Provider** `src/main/host/github.ts` behind a `HostProvider` interface
  (`detectHost` parses `origin` → github.com/gitlab.com):
  - `listPullRequests(repo)`, `pullRequestForBranch(repo, branch)`,
    `checksForRef(repo, sha)` (CI rollup), `createPullRequest(repo, {head, base, title,
body})`, `checkoutPullRequest(repo, number)` (fetch `pull/<n>/head` + checkout).
  - Node `fetch` against the REST/GraphQL API in the main process; handle rate-limit +
    auth errors into `OpResult`.
- **Contract + store + UI:** add the calls to `GitCityApi`; a **Pull Requests** panel
  (open PRs, current-branch PR, CI check badges, open-in-browser, checkout); a **Create
  PR** dialog wired to the current branch; CI status pill in the top bar when the branch
  has an upstream PR. Command Palette: "Create PR", "Checkout PR…", "Open PR in browser".
- **Phasing:** **v12a** read-only (detect + auth + list PRs + CI + open-in-browser +
  checkout) → **v12b** create PR → **v12c** GitLab provider.
- **Tests:** `detectHost` URL parsing, response→model mappers (pure-logic, fixture JSON).
- **Risks & guardrails:** network only in main; least-privilege token scope (`repo`);
  encrypted at rest; graceful offline/te­rmination; **never** auto-merge or force-push;
  creating a PR is an explicit user action behind a confirm.

---

## Cross-cutting

- Each milestone: `typecheck && lint && test` per commit, preview verification of the
  visible UI, mode-switch e2e, then a Windows exe rebuild before merge.
- Contract-first: land `shared/types.ts` + IPC in the first commit of each milestone so
  the renderer types are stable.
- Keep the Command Palette the single discovery surface — every new capability gets a
  palette entry.
