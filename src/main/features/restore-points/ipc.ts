import { restorePointChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry, requireString } from '../../core'
import type { RestorePointsFacade } from './wire'

export interface RestorePointsIpcOptions {
  ipc: IpcHandlerRegistry
  engine: RestorePointsFacade
  broadcastChanged(): void
}

/** Lets the ticket drawer read a ticket's restore points and go back to one. Holds no state. */
export function registerRestorePointsIpc({ ipc, engine, broadcastChanged }: RestorePointsIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.restorePoints.onChange(broadcastChanged)

  ipc.handle(restorePointChannels.of, (_event, ticketId) =>
    attempt(() => engine.restorePoints.of(requireTicketId(ticketId))),
  )
  ipc.handle(restorePointChannels.losses, (_event, id) =>
    attempt(() => engine.restorePoints.losses(requireString(id, 'restore point'))),
  )
  ipc.handle(restorePointChannels.goBack, (_event, id) =>
    attempt(() => engine.restorePoints.goBack(requireString(id, 'restore point'))),
  )
}

function requireTicketId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('Missing ticket id')
  return value as number
}
