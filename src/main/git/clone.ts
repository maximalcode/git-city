import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import type { ProgressInfo } from '../../shared/types'

/** Derive a safe directory name from a repo URL, e.g. ".../expressjs/express.git" → "express". */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, '').replace(/\.git$/, '')
  const name = cleaned.split(/[/:]/).pop() ?? ''
  const safe = name.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!safe) throw new Error('Could not derive a repository name from that URL.')
  return safe
}

export async function cloneRepo(
  url: string,
  onProgress: (p: ProgressInfo) => void
): Promise<string> {
  const trimmed = url.trim()
  if (!/^(https?:\/\/|git@)/.test(trimmed)) {
    throw new Error('Please enter an https:// or git@ repository URL.')
  }
  const name = repoNameFromUrl(trimmed)
  const clonesDir = join(app.getPath('userData'), 'clones')
  await mkdir(clonesDir, { recursive: true })
  const dest = join(clonesDir, name)

  // Reuse an existing clone of the same name (MVP behaviour).
  if (existsSync(join(dest, '.git'))) return dest

  const git = simpleGit({
    progress({ stage, progress }) {
      onProgress({ phase: 'cloning', done: progress, total: 100 })
      void stage
    }
  })
  await git.clone(trimmed, dest)
  return dest
}
