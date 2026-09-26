import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { RehearsalMode, RehearsalModeSetting } from '../shared/types'
import { withRepoLock } from './git/queue'
import { commonRepository } from './rehearsalRecovery'

interface Settings {
  schema: 1
  legacy: string[]
  repositories: Record<string, RehearsalMode | null>
}
const isMode = (value: unknown): value is RehearsalMode =>
  value === 'automatic' || value === 'ask' || value === 'off'

/** App-owned, versioned preferences. The canonical common git directory is the key,
 * never the current worktree. Null means the existing user has not chosen yet. */
export async function rehearsalMode(
  file: string,
  enabled: boolean,
  repo: string,
  known: string[] = [],
  choice?: RehearsalMode
): Promise<RehearsalModeSetting | null> {
  return withRepoLock(file, async () => {
    let settings: Settings
    try {
      const value = JSON.parse(await readFile(file, 'utf8'))
      if (
        value?.schema !== 1 ||
        !Array.isArray(value.legacy) ||
        !value.legacy.every((path: unknown) => typeof path === 'string') ||
        !value.repositories ||
        typeof value.repositories !== 'object' ||
        Array.isArray(value.repositories) ||
        !Object.values(value.repositories).every((mode) => mode === null || isMode(mode))
      )
        throw new Error('Incompatible Rehearse settings. Preserve the file and repair the app.')
      settings = value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (!enabled) return null
      settings = { schema: 1, legacy: [...known], repositories: {} }
    }
    const repository = await commonRepository(repo)
    // Keep unresolved legacy paths: a temporarily unavailable worktree must not
    // silently become a new repository when it is opened on a later launch.
    const unresolved: string[] = []
    for (const path of settings.legacy) {
      try {
        const key = await commonRepository(path)
        if (!(key in settings.repositories)) settings.repositories[key] = null
      } catch {
        unresolved.push(path)
      }
    }
    settings.legacy = unresolved
    if (!(repository in settings.repositories)) settings.repositories[repository] = 'automatic'
    if (choice !== undefined) {
      if (!isMode(choice)) throw new Error('Choose Automatic, Ask or Off.')
      settings.repositories[repository] = choice
    }
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file + '.tmp', JSON.stringify(settings), 'utf8')
    await rename(file + '.tmp', file)
    return { repository, mode: settings.repositories[repository] }
  })
}
