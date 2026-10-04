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
  const read = (): Promise<RehearsalModeSetting | null> =>
    rehearsalMode(
      join(app.getPath('userData'), 'rehearsal-modes.json'),
      app.isPackaged || Boolean(process.env.GIT_CITY_REHEARSE_BIN),
      repo,
      known,
      choice
    )
  return choice === undefined ? read() : withRepositoryWrite(repo, read)
}
