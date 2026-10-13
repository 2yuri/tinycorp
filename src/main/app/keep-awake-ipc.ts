import { isKeepAwakeMode } from '../../shared/app/keep-awake'
import { keepAwakeChannels } from '../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../core'
import type { KeepAwake } from './keep-awake'

export interface KeepAwakeIpcOptions {
  ipc: IpcHandlerRegistry
  keepAwake: KeepAwake
}

/** Serves the cup on the map: what it should draw, and the mode the boss picks in its menu. */
export function registerKeepAwakeIpc({ ipc, keepAwake }: KeepAwakeIpcOptions): void {
  ipc.handle(keepAwakeChannels.get, () => keepAwake.state())
  ipc.handle(keepAwakeChannels.setMode, (_event, mode) =>
    attempt(() => {
      if (!isKeepAwakeMode(mode)) throw new Error(`Unknown keep-awake mode: ${String(mode)}`)
      keepAwake.setMode(mode)
      return keepAwake.state()
    }),
  )
}
