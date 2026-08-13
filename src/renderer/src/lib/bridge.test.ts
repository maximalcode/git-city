import { afterEach, describe, expect, it } from 'vitest'
import type { GitCityApi } from '../../../shared/types'
import { bridge, cleanError, hasApi, setBridge } from './bridge'

afterEach(() => setBridge(null))

describe('bridge', () => {
  it('reports no api instead of throwing when there is no window at all', () => {
    // vitest runs in node: `'gitCity' in window` used to throw a ReferenceError,
    // which is why nothing in the store could be unit-tested (#106).
    expect(hasApi()).toBe(false)
    expect(bridge()).toBeNull()
  })

  it('hands out an injected api', () => {
    const fake = { reflog: async () => [] } as unknown as GitCityApi
    setBridge(fake)
    expect(hasApi()).toBe(true)
    expect(bridge()).toBe(fake)
  })

  it('forgets the injected api again', () => {
    setBridge({} as GitCityApi)
    setBridge(null)
    expect(hasApi()).toBe(false)
  })
})

describe('cleanError', () => {
  it('strips the Electron IPC prefix', () => {
    expect(
      cleanError(new Error("Error invoking remote method 'reflog': Error: fatal: bad revision"))
    ).toBe('fatal: bad revision')
  })

  it('strips the prefix even when git left no Error: of its own', () => {
    expect(cleanError(new Error("Error invoking remote method 'blame': nope"))).toBe('nope')
  })

  it('leaves an ordinary message alone', () => {
    expect(cleanError(new Error('nothing to see here'))).toBe('nothing to see here')
  })

  it('stringifies whatever it is handed', () => {
    expect(cleanError('a bare string')).toBe('a bare string')
  })
})
