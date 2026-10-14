import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  pending: false,
  failed: false,
  wait: Promise.resolve(),
  listener: null as null | ((event: { preventDefault: () => void }) => void),
  quit: vi.fn(),
  prompt: vi.fn()
}))
vi.mock('electron', () => ({
  app: {
    on: (_event: string, listener: (event: { preventDefault: () => void }) => void) => {
      state.listener = listener
    },
    quit: state.quit
  },
  dialog: { showMessageBox: state.prompt }
}))
vi.mock('./rehearsalDraftIpc', () => ({
  rehearsalDraftWritesPending: () => state.pending,
  rehearsalDraftPersistenceFailed: () => state.failed,
  waitForRehearsalDraftWrites: () => state.wait
}))

beforeEach(() => {
  vi.resetModules()
  state.pending = false
  state.failed = false
  state.wait = Promise.resolve()
  state.listener = null
  state.quit.mockReset()
  state.prompt.mockReset()
})

async function setup(): Promise<(event: { preventDefault: () => void }) => void> {
  const { registerRehearsalDraftQuitBarrier } = await import('./rehearsalDraftQuit')
  registerRehearsalDraftQuitBarrier()
  if (!state.listener) throw new Error('quit listener was not registered')
  return state.listener
}

it('continues blocking repeated native quits until pending writes settle', async () => {
  let release = (): void => {}
  state.wait = new Promise<void>((resolve) => {
    release = resolve
  })
  state.pending = true
  const quit = await setup()
  const first = { preventDefault: vi.fn() }
  const repeated = { preventDefault: vi.fn() }
  quit(first)
  quit(repeated)
  expect(first.preventDefault).toHaveBeenCalledOnce()
  expect(repeated.preventDefault).toHaveBeenCalledOnce()
  expect(state.quit).not.toHaveBeenCalled()
  state.pending = false
  release()
  await vi.waitFor(() => expect(state.quit).toHaveBeenCalledOnce())
})

it('honors explicit abandonment once without prompting in an endless quit loop', async () => {
  state.failed = true
  state.prompt.mockResolvedValue({ response: 1 })
  const quit = await setup()
  quit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.quit).toHaveBeenCalledOnce())
  const confirmed = { preventDefault: vi.fn() }
  quit(confirmed)
  expect(confirmed.preventDefault).not.toHaveBeenCalled()
  expect(state.prompt).toHaveBeenCalledOnce()
})

it('keeps editing as the default and leaves another quit attempt protected after cancel', async () => {
  state.failed = true
  state.prompt.mockResolvedValue({ response: 0 })
  const quit = await setup()
  quit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.prompt).toHaveBeenCalledOnce())
  expect(state.prompt).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 0, cancelId: 0 }))
  expect(state.quit).not.toHaveBeenCalled()
  const retry = { preventDefault: vi.fn() }
  quit(retry)
  expect(retry.preventDefault).toHaveBeenCalledOnce()
})
