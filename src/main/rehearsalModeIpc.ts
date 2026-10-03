import { app } from 'electron'
import { join } from 'path'
import type { RehearsalMode, RehearsalModeSetting } from '../shared/types'
import { rehearsalMode } from './rehearsalMode'
import { withRepositoryWrite } from './repositoryQueue'

export function getRehearsalMode(
  repo: string,
  known: string[] = [],
  choice?: RehearsalMode
): Promise<RehearsalModeSetting | null> {
  // Public activation is reserved for the final acceptance ticket. Once internally
  // initialized, a missing executable must not disable Automatic silently in a
  // development renderer. npm start loads production UI, which has no controls.
  if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL) return Promise.resolve(null)
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
