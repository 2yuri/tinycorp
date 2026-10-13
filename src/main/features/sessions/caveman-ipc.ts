import { isCavemanLevel } from '../../../shared/caveman'
import { cavemanChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { CavemanFacade } from './facade'

export interface CavemanIpcOptions {
  ipc: IpcHandlerRegistry
  engine: CavemanFacade
}

/**
 * The Add-ons tab's half of Caveman (T261): read how this Company answers the boss, and set it.
 *
 * It saves as it changes, like the build style beside it — flipping an add-on or moving its
 * intensity is not a draft, and it only takes at the next Session start anyway, so there is nothing
 * to undo before then.
 */
export function registerCavemanIpc({ ipc, engine }: CavemanIpcOptions): void {
  ipc.handle(cavemanChannels.get, () => attempt(() => engine.caveman.get()))
  ipc.handle(cavemanChannels.set, (_event, level) =>
    attempt(() => {
      if (!isCavemanLevel(level)) throw new Error(`Unknown caveman level: ${String(level)}`)
      return engine.caveman.set(level)
    }),
  )
}
