import type { SigningConfig } from '../../shared/types'
import { runGitResult } from './exec'

/**
 * Read the repo's commit-signing configuration so the commit box can default
 * its "Sign" toggle correctly. We never touch keys — gpg-agent / ssh-agent own
 * those; we only read config and pass `-S` / `--no-gpg-sign` to `git commit`.
 */
export async function getSigningConfig(repoPath: string): Promise<SigningConfig> {
  const [gpgsign, format] = await Promise.all([
    runGitResult(repoPath, ['config', '--get', 'commit.gpgsign']),
    runGitResult(repoPath, ['config', '--get', 'gpg.format'])
  ])
  const signByDefault = gpgsign.code === 0 && gpgsign.stdout.trim() === 'true'
  const raw = format.code === 0 ? format.stdout.trim() : ''
  const fmt: SigningConfig['format'] = raw === 'ssh' ? 'ssh' : raw === 'x509' ? 'x509' : 'openpgp'
  return { signByDefault, format: fmt }
}
