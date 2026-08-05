/**
 * The environment handed to simple-git for remote operations (fetch, pull,
 * push, clone).
 *
 * This is an **allowlist**, and the reason is worth stating. simple-git's
 * block-unsafe-operations plugin inspects the environment you give it and
 * *throws* on anything it considers risky, rather than dropping it. It objects
 * to 17 variables. The previous denylist stripped 6, so an ordinary
 * `export PAGER=less` in a shell profile made every fetch, pull and push fail
 * with "Use of \"PAGER\" is not permitted without enabling allowUnsafePager" —
 * an option the user has never heard of, about a variable they set for
 * something else entirely (#44).
 *
 * A denylist here has to track a third-party plugin's internal list forever.
 * An allowlist only has to describe what git needs, which changes far less
 * often and is ours to reason about.
 *
 * What git needs to reach a remote:
 *  - PATH             — to find git, ssh, and credential helpers
 *  - HOME / XDG       — ~/.gitconfig, ~/.ssh, ~/.config/git
 *  - SSH_AUTH_SOCK    — the running ssh-agent
 *  - the proxy vars   — corporate networks
 *  - the Windows set  — USERPROFILE/APPDATA are that platform's HOME, and
 *                       SystemRoot is required for sockets to work at all
 */
const ALLOWED = [
  'PATH',
  'HOME',
  'XDG_CONFIG_HOME',
  'SSH_AUTH_SOCK',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  // proxies, in both the spellings the ecosystem uses
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  // Windows
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'PATHEXT',
  'COMSPEC'
] as const

/**
 * Build the remote-op environment from `source` (defaults to the process
 * environment). `PATH` is overridable so callers can pass the augmented search
 * path a GUI launch needs.
 */
export function remoteEnv(
  source: NodeJS.ProcessEnv = process.env,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ALLOWED) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  // The GUI has no terminal to answer a credential prompt, so a missing
  // credential must fail fast rather than hang a child process forever.
  env.GIT_TERMINAL_PROMPT = '0'
  return { ...env, ...overrides }
}
