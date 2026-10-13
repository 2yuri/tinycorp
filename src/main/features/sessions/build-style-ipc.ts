import { isBuildStyle } from '../../../shared/build-style'
import { buildStyleChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { BuildStyleFacade } from './facade'

export interface BuildStyleIpcOptions {
  ipc: IpcHandlerRegistry
  engine: BuildStyleFacade
}

/**
 * The Add-ons tab's half of Lean builder (T194): read the Company's build style and set it.
 *
 * It saves as it changes, like the notes budget and the colleague voice — flipping an add-on is
 * not a draft, and it only takes at the next Session start anyway, so there is nothing to undo
 * before then.
 */
export function registerBuildStyleIpc({ ipc, engine }: BuildStyleIpcOptions): void {
  ipc.handle(buildStyleChannels.get, () => attempt(() => engine.buildStyle.get()))
  ipc.handle(buildStyleChannels.set, (_event, style) =>
    attempt(() => {
      if (!isBuildStyle(style)) throw new Error(`Unknown build style: ${String(style)}`)
      return engine.buildStyle.set(style)
    }),
  )
}
