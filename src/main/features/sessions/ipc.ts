import { sessionChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry, requireString } from '../../core'
import type { SessionsFacade } from './facade'

export interface SessionIpcOptions {
  ipc: IpcHandlerRegistry
  engine: SessionsFacade
  broadcastChanged(): void
}

/** Lets the renderer start and stop Sessions and watch their status. Holds no state of its own. */
export function registerSessionIpc({ ipc, engine, broadcastChanged }: SessionIpcOptions): void {
  engine.sessions.onChange(broadcastChanged)

  ipc.handle(sessionChannels.list, () => attempt(() => engine.sessions.list()))
  ipc.handle(sessionChannels.start, (_event, employeeId) =>
    attempt(() => engine.sessions.start(requireString(employeeId, 'Employee id'))),
  )
  ipc.handle(sessionChannels.stop, (_event, employeeId) =>
    attempt(() => engine.sessions.stop(requireString(employeeId, 'Employee id'))),
  )
  ipc.handle(sessionChannels.paused, () => attempt(() => engine.sessions.paused()))
  ipc.handle(sessionChannels.pauseAll, () =>
    attempt(() => {
      engine.sessions.stopAll()
      return engine.sessions.paused()
    }),
  )
  // Builds a line for the clipboard. Nothing here starts a process (T164).
  ipc.handle(sessionChannels.handoffCommand, (_event, employeeId) =>
    attempt(() => engine.sessions.handoffCommand(requireString(employeeId, 'Employee id'))),
  )
  // The whole outcome, not just the paused state: a resume that brought nobody back has to reach
  // the boss wherever they pressed the button, not only the log (T217).
  ipc.handle(sessionChannels.resumeAll, () => attempt(() => engine.sessions.startAll()))
}
