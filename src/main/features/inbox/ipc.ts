import { inboxChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry, requireString } from '../../core'
import type { InboxFacade } from './wire'

export interface InboxIpcOptions {
  ipc: IpcHandlerRegistry
  engine: InboxFacade
  broadcastChanged(): void
}

/** Lets the renderer read Employees' inboxes. Holds no state of its own. */
export function registerInboxIpc({ ipc, engine, broadcastChanged }: InboxIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.inbox.onChange(broadcastChanged)

  ipc.handle(inboxChannels.list, (_event, employeeId) =>
    attempt(() => engine.inbox.list(requireString(employeeId, 'Employee id'))),
  )
}
