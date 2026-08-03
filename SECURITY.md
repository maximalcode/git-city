# Security

Git City is a desktop app that reads your source repositories and can write to
them. That is a lot of trust, so this document states plainly what it does with
your data, what it runs, and how to report a problem.

## Reporting a vulnerability

Use GitHub's private reporting:
**[Report a vulnerability](https://github.com/maximalcode/git-city/security/advisories/new)**.
That opens a private advisory only maintainers can read.

Please **do not** open a public issue for anything exploitable.

Include what you did, what happened, the OS and Git City version, and a proof of
concept if you have one. This is a solo hobby project, so expect a first reply
within about a week rather than within hours. There is no bug bounty.

Supported: the **latest release**. Fixes go into the next release rather than
being backported.

## What leaves your machine

**One request, and it is not about you.** At launch — and when you press _Check
for updates_ in Settings — Git City asks
`https://api.github.com/repos/maximalcode/git-city/releases/latest` whether a
newer version exists. It is unauthenticated, carries the `User-Agent: git-city`
header and nothing else, times out after 6 seconds, and fails silently. No
repository data, no path, no identifier of any kind is sent. See
[`src/main/updates.ts`](src/main/updates.ts).

Everything else that touches the network is **git itself, doing what you asked**:
fetch, pull, push and clone go to the remotes already configured in your
repository, using your existing credentials.

There is **no telemetry**, no analytics, no crash reporting, no accounts and no
"phone home" of any other kind.

## Credentials

Git City **stores no tokens, passwords or keys**. It has no credential store,
and nothing it writes to disk contains a secret.

- **Remote authentication** — handled by git and your own credential helper.
  Git City never prompts for a password, and never sees one. Its git
  invocations run with `GIT_TERMINAL_PROMPT=0`, so a missing credential fails
  fast rather than blocking on a prompt you cannot see. (`clone` is the one
  call that does not yet set it —
  [#25](https://github.com/maximalcode/git-city/issues/25).)
- **Pull requests** — shelled out to the official `gh` / `glab` CLIs, which
  hold their own login. Git City never sees the token.
- **Commit signing** — delegated to `gpg-agent` / `ssh-agent`. Keys and
  passphrases stay there.

## What it executes

Git City runs `git`, and `gh` / `glab` when you open the Pull Requests panel. It
finds them on your `PATH`; it bundles no binaries of its own.

Every invocation goes through `spawn` with an **argument array** — never a shell
string — so a branch name, path or commit message cannot become a command.

The one exception is the interactive rebase, which has to hand git a
`GIT_SEQUENCE_EDITOR` command that git then runs through a shell. Git City sets
it to a `cp` of a todo file it wrote itself, under a name it generated, in the
system temp directory ([`git/rebaseInteractive.ts`](src/main/git/rebaseInteractive.ts));
no repository content reaches that string.

**Force-push is deliberately not implemented**, and neither is auto-merge. Both
are easy to add and easy to regret; the app should not be able to destroy
history you cannot get back.

## The Electron surface

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`,
  set explicitly rather than inherited from Electron's defaults.
- The only bridge is the typed `window.gitCity` API in
  [`src/preload/`](src/preload/index.ts), exposed through `contextBridge` — a
  fixed list of IPC channels. The renderer cannot reach Node or the filesystem
  directly.
- The window will not navigate away from the bundled UI, and new-window
  requests are denied; external links open in your real browser instead
  ([`main/appUrl.ts`](src/main/appUrl.ts)).
- The app loads no remote code. Everything, including textures, is bundled at
  build time.

`sandbox` is off for the renderer — a sandboxed preload cannot load the bridge
module. That is the one place this app is less locked down than an Electron app
could be.

## Dependencies

The shipped app has **one runtime dependency**, `simple-git`. Everything else in
`package.json` is a devDependency that exists only at build time. This is a
standing rule, not an accident — it is the cheapest supply-chain defence
available to a project this size.

## Builds

Releases are built by
[the release workflow](.github/workflows/release.yml) from the tagged commit, in
public, so you can read exactly what produced the file you downloaded.

**The installers are unsigned.** Code signing needs a paid certificate
([#7](https://github.com/maximalcode/git-city/issues/7)); until then, macOS and
Windows will both warn you on first launch — see
[docs/troubleshooting.md](docs/troubleshooting.md). Verify a download by
checking it came from the
[Releases page](https://github.com/maximalcode/git-city/releases) of this
repository and that its size matches.
