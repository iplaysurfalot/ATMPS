import type { IpcApi } from '@shared/types'

declare global {
  interface Window {
    atmps: IpcApi
  }
}

export {}
