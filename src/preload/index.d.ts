import type { GitCityApi } from '../shared/types'

declare global {
  interface Window {
    gitCity: GitCityApi
  }
}

export {}
