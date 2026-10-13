import { editorsChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { Editors } from './editors'

export interface EditorsIpcOptions {
  ipc: IpcHandlerRegistry
  editors: Editors
}

/**
 * Serves the `Open in …` button: what this Mac has, and the row the boss clicked in its list
 * (T123). Nothing here takes a command — only an editor the app already knows by name.
 */
export function registerEditorsIpc({ ipc, editors }: EditorsIpcOptions): void {
  ipc.handle(editorsChannels.get, () => editors.state())
  ipc.handle(editorsChannels.choose, (_event, id) =>
    attempt(() => editors.choose(typeof id === 'string' ? id : String(id))),
  )
}
