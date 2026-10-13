import type { TinyCorpApi } from '../shared/ipc'

declare global {
  interface Window {
    tinyCorp: TinyCorpApi
  }
}
