import { capacityChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { CapacityFacade } from './facade'

export interface CapacityIpcOptions {
  ipc: IpcHandlerRegistry
  engine: CapacityFacade
  broadcastChanged(): void
}

/** Lets the renderer read and set the concurrency cap and watch the budget. Holds no state of its own. */
export function registerCapacityIpc({ ipc, engine, broadcastChanged }: CapacityIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.capacity.onChange(broadcastChanged)

  ipc.handle(capacityChannels.get, () => attempt(() => engine.capacity.get()))
  ipc.handle(capacityChannels.usage, () => attempt(() => engine.capacity.usage()))
  ipc.handle(capacityChannels.setConcurrencyCap, (_event, cap) =>
    attempt(() => {
      if (typeof cap !== 'number') throw new Error('The concurrency cap must be a number')
      return engine.capacity.setConcurrencyCap(cap)
    }),
  )
}
