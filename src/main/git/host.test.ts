import { describe, it, expect } from 'vitest'
import { detectHost, hostnameOf } from './host'

describe('hostnameOf', () => {
  it('parses scp-like SSH remotes', () => {
    expect(hostnameOf('git@github.com:owner/repo.git')).toBe('github.com')
    expect(hostnameOf('git@gitlab.com:group/sub/repo.git')).toBe('gitlab.com')
    // no user part is still valid scp syntax
    expect(hostnameOf('gitlab.example.org:group/repo.git')).toBe('gitlab.example.org')
  })

  it('parses ssh:// URLs, including a port', () => {
    expect(hostnameOf('ssh://git@gitlab.example.com:2222/group/repo.git')).toBe(
      'gitlab.example.com'
    )
    expect(hostnameOf('ssh://git@github.com/owner/repo.git')).toBe('github.com')
  })

  it('parses https remotes and lowercases the host', () => {
    expect(hostnameOf('https://github.com/owner/repo.git')).toBe('github.com')
    expect(hostnameOf('https://GitLab.com/group/repo')).toBe('gitlab.com')
    expect(hostnameOf('https://user@gitlab.example.com/group/repo.git')).toBe('gitlab.example.com')
  })

  it('returns null for empty or unparseable input', () => {
    expect(hostnameOf('')).toBeNull()
    expect(hostnameOf('   ')).toBeNull()
    expect(hostnameOf('not a url at all')).toBeNull()
  })
})

describe('detectHost', () => {
  it('recognises Azure DevOps remotes over every supported URL shape', () => {
    expect(detectHost('https://dev.azure.com/acme/project/_git/repo')).toBe('azure')
    expect(detectHost('git@ssh.dev.azure.com:v3/acme/project/repo')).toBe('azure')
    expect(detectHost('https://acme.visualstudio.com/project/_git/repo')).toBe('azure')
  })

  it('does not claim an Azure lookalike domain', () => {
    expect(detectHost('https://dev.azure.com.evil.example/acme/project/_git/repo')).toBe('unknown')
    expect(detectHost('https://evil.example.visualstudio.com/project/_git/repo')).toBe('unknown')
  })

  it('recognises github.com over every remote syntax', () => {
    expect(detectHost('git@github.com:owner/repo.git')).toBe('github')
    expect(detectHost('https://github.com/owner/repo.git')).toBe('github')
    expect(detectHost('ssh://git@github.com/owner/repo.git')).toBe('github')
  })

  it('recognises gitlab.com over every remote syntax', () => {
    expect(detectHost('git@gitlab.com:group/repo.git')).toBe('gitlab')
    expect(detectHost('https://gitlab.com/group/sub/repo.git')).toBe('gitlab')
    expect(detectHost('ssh://git@gitlab.com:2222/group/repo.git')).toBe('gitlab')
  })

  it('recognises self-hosted instances that keep the vendor name in the domain', () => {
    expect(detectHost('https://gitlab.acme.com/group/repo.git')).toBe('gitlab')
    expect(detectHost('git@gitlab.internal.acme.com:group/repo.git')).toBe('gitlab')
    expect(detectHost('https://github.acme.com/owner/repo.git')).toBe('github')
  })

  it('does not fall for a lookalike domain', () => {
    // the vendor name has to be its own label, not a substring
    expect(detectHost('https://github.com.evil.example/owner/repo.git')).toBe('unknown')
    expect(detectHost('https://notgithub.com/owner/repo.git')).toBe('unknown')
    expect(detectHost('https://mygitlabhost.com/group/repo.git')).toBe('unknown')
  })

  it('reports unknown for a neutral self-hosted domain, rather than guessing', () => {
    // providerFor asks the CLIs directly in this case
    expect(detectHost('https://git.acme.com/group/repo.git')).toBe('unknown')
    expect(detectHost('git@code.acme.io:group/repo.git')).toBe('unknown')
  })

  it('reports unknown for junk', () => {
    expect(detectHost('')).toBe('unknown')
    expect(detectHost('nonsense')).toBe('unknown')
  })
})
