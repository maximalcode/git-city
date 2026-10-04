import type { HostKind } from './hostKind'

/**
 * Pull the hostname out of a remote URL. Git accepts three shapes and only one
 * of them is a URL `URL` can parse:
 *   scp-like   git@host:group/repo.git
 *   ssh URL    ssh://git@host:2222/group/repo.git
 *   http(s)    https://host/group/repo.git
 * Exported for tests.
 */
export function hostnameOf(originUrl: string): string | null {
  const url = originUrl.trim()
  if (!url) return null
  // scp-like: no scheme, and the colon comes before any slash
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)/.exec(url)
  if (scp && !url.includes('://')) return scp[1].toLowerCase()
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Which forge a remote URL points at, by hostname.
 *
 * A self-hosted instance on a neutral domain (`git.acme.com`) is genuinely
 * indistinguishable from any other host by URL alone, so it resolves to
 * `unknown` here on purpose — {@link providerFor} then asks the CLIs directly
 * rather than guessing. Exported for tests.
 */
export function detectHost(originUrl: string): HostKind {
  const host = hostnameOf(originUrl)
  if (!host) return 'unknown'
  // Azure Repos has modern dev.azure.com/SSH hosts and legacy organization
  // subdomains. Keep the visualstudio match to one organization label.
  if (
    host === 'dev.azure.com' ||
    host === 'ssh.dev.azure.com' ||
    (host.endsWith('.visualstudio.com') && host.split('.').length === 3)
  ) {
    return 'azure'
  }
  for (const vendor of ['github', 'gitlab'] as const) {
    if (matches(host, vendor)) return vendor
  }
  return 'unknown'
}

/** Labels that mean the name before them was never the registrable domain. */
const TLD_LIKE = new Set(['com', 'net', 'org', 'io', 'dev'])

function matches(host: string, vendor: 'github' | 'gitlab'): boolean {
  // the real thing, or a subdomain of it
  if (host === `${vendor}.com` || host.endsWith(`.${vendor}.com`)) return true
  const labels = host.split('.')
  // a self-hosted instance puts the vendor leftmost: gitlab.acme.com.
  // "github.com.evil.example" has the same shape, so a TLD-like second label
  // disqualifies it — there the registrable domain is evil.example, not GitHub.
  return labels[0] === vendor && labels.length > 1 && !TLD_LIKE.has(labels[1])
}
