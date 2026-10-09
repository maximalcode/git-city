import { app, dialog } from 'electron'
import {
  rehearsalDraftPersistenceFailed,
  rehearsalDraftWritesPending,
  waitForRehearsalDraftWrites
} from './rehearsalDraftIpc'

let quitBarrierActive = false
let quitBarrierInstalled = false
let abandonmentConfirmed = false

export function registerRehearsalDraftQuitBarrier(): void {
  if (!quitBarrierInstalled) {
    quitBarrierInstalled = true
    app.on('before-quit', (event) => {
      if (abandonmentConfirmed) return
      if (quitBarrierActive) {
        event.preventDefault()
        return
      }
      if (!rehearsalDraftWritesPending() && !rehearsalDraftPersistenceFailed()) return
      event.preventDefault()
      quitBarrierActive = true
      void (async () => {
        // Requests already admitted by IPC must reach a durable result before
        // asking whether the user wants to abandon a failed draft.
        await waitForRehearsalDraftWrites()
        if (!rehearsalDraftPersistenceFailed()) {
          quitBarrierActive = false
          app.quit()
          return
        }
        const choice = await dialog.showMessageBox({
          type: 'warning',
          title: 'Unsaved rehearsal draft',
          message: 'A rehearsal editor draft could not be saved.',
          detail: 'Keep Git City open to retry persistence, or quit and abandon this draft.',
          buttons: ['Keep editing', 'Quit and abandon draft'],
          defaultId: 0,
          cancelId: 0,
          noLink: true
        })
        quitBarrierActive = false
        if (choice.response === 1) {
          abandonmentConfirmed = true
          app.quit()
        }
      })().catch(() => {
        quitBarrierActive = false
      })
    })
  }
}
