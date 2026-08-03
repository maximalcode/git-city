# Troubleshooting

If something here doesn't cover your problem,
[open an issue](https://github.com/maximalcode/git-city/issues/new/choose) —
include your OS, the Git City version, and what the screen said.

## "Git City is damaged and can't be opened" (macOS)

Nothing is damaged. **The installers are unsigned**, so macOS refuses to run
them and words it alarmingly. Signing needs a paid Apple Developer ID; it is on
the roadmap ([#7](https://github.com/maximalcode/git-city/issues/7)).

Two ways past it:

1. Right-click (or Control-click) **Git City** in Applications → **Open** → the
   dialog now has an **Open** button. You only do this once.
2. Or, in Terminal:

   ```bash
   xattr -d com.apple.quarantine "/Applications/Git City.app"
   ```

If the app is still refused after step 1, check **System Settings → Privacy &
Security** — there is usually an "Open anyway" button near the bottom for a
few minutes after a blocked launch.

## "Windows protected your PC" / unknown publisher

Same cause: the installer is unsigned, so SmartScreen has no reputation for it.
Choose **More info → Run anyway**.

Both installers are built in public by
[the release workflow](../.github/workflows/release.yml) from the tagged commit,
so you can check what went into the file you downloaded.

## "Git is not installed, or not on your PATH"

Git City drives the real `git` binary — it does not bundle one. Installing the
`.exe` or `.dmg` does not install git.

- **macOS** — `xcode-select --install`, or `brew install git`
- **Windows** — [git-scm.com](https://git-scm.com/download/win)
- **Linux** — your package manager (`apt install git`, `dnf install git`, …)

Then **restart Git City** — it reads `PATH` at launch.

**Git 2.31 or newer.** Older versions report merge commits differently, and the
city comes out silently wrong — files that only ever arrived through a merge are
missing, and heights are off — rather than visibly broken. Check yours with
`git --version`.

## The Pull Requests panel says a CLI is missing

Git City never stores a token. Pull requests go through the official CLIs, using
whatever login you already have:

- **GitHub** — install [`gh`](https://cli.github.com), then `gh auth login`
- **GitLab** — install [`glab`](https://gitlab.com/gitlab-org/cli), then
  `glab auth login`

If you installed the CLI while Git City was open, press **↻** in the panel.

## Opening a repository takes minutes

Git City replays the entire history to know each file's size at every commit.
That cost scales with commits × files: a normal repository opens in seconds, but
a monorepo genuinely takes minutes (measured: 14,271 commits and 81,368 files →
about 130 seconds). Above roughly 20,000 files you get a warning with the real
numbers and a way out before the wait starts.

Above about 60,000 files the street network stops being drawn — the plots are
too small for roads to fit. Tracked in
[#12](https://github.com/maximalcode/git-city/issues/12).

## "The selected folder is not a git repository" — but it is

Git City renders a **working tree**, so it needs the folder that _contains_
`.git` — not `.git` itself, and not a `--bare` clone. For a bare repository,
clone it first (`git clone <path> <dest>`) and open the clone.

The same message also appears when Git City cannot _read_ the folder at all, so
if the path is definitely a normal repository, check its permissions and
ownership. Running `git status` in that folder yourself will usually name the
real cause — including git's "dubious ownership" advice, which tells you the
exact `git config --global --add safe.directory …` line to run.

## The city looks empty, or the scene is dark

- **A repository with no commits** shows a "No commits yet" screen by design —
  there is no history to grow a city from. Make a commit and it fills in.
- **Everything one colour** on a very new repository is expected for the
  Activity, Recency and Size encodings: with one commit there is no spread to
  show. See [colour modes](colour-modes.md).
- **Try another theme** — `,` opens Settings. Some themes are deliberately dark.

## Performance is poor / the fans spin up

Settings (`,`) has the knobs that matter: turn off effects, reduce motion, and
lower the detail budget. Git City renders a real 3D scene, so it uses the GPU
like a game does.

## Where is my data?

Nowhere but your machine. Git City has no telemetry and no accounts. Its only
outbound request is a version check against GitHub's public releases API at
launch — see [SECURITY.md](../SECURITY.md) for exactly what it sends.
