import { app } from 'electron'
import { join } from 'path'
import type { RehearsalMode, RehearsalModeSetting } from '../shared/types'
import { rehearsalMode } from './rehearsalMode'
import { withRepositoryWrite } from './rehearsalRecovery'

export function getRehearsalMode(
  repo: string,
  known: string[] = [],
  choice?: RehearsalMode
): Promise<RehearsalModeSetting | null> {
  // Public activation is reserved for the final acceptance ticket. Once internally
  // initialized, a missing executable must not disable Automatic silently.
  if (app.isPackaged) return Promise.resolve(null)
  const read = (): Promise<RehearsalModeSetting | null> =>
    rehearsalMode(
      join(app.getPath('userData'), 'rehearsal-modes.json'),
      Boolean(process.env.GIT_CITY_REHEARSE_BIN),
      repo,
      known,
      choice
    )
  return choice === undefined ? read() : withRepositoryWrite(repo, read)
}
