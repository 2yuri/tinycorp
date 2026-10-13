import { officeChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { OfficeFacade } from './wire'

export interface OfficeIpcOptions {
  ipc: IpcHandlerRegistry
  engine: OfficeFacade
  broadcastChanged(): void
}

/** Lets the renderer read what the office shows and watch it change. Holds no state of its own. */
export function registerOfficeIpc({ ipc, engine, broadcastChanged }: OfficeIpcOptions): void {
  engine.office.onChange(broadcastChanged)

  ipc.handle(officeChannels.facts, () => attempt(() => engine.office.facts()))
  ipc.handle(officeChannels.room, () => attempt(() => engine.office.room()))
  ipc.handle(officeChannels.setRoom, (_event, slug) =>
    attempt(() => {
      if (typeof slug !== 'string') throw new Error('A room is picked by its slug')
      return engine.office.setRoom(slug)
    }),
  )
}
