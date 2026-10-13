import { answererChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { AnswererFacade } from './wire'

export interface AnswererIpcOptions {
  ipc: IpcHandlerRegistry
  engine: AnswererFacade
  broadcastChanged(): void
}

/** Lets the renderer read and set "Who answers you" and follow the chain. Holds no state of its own. */
export function registerAnswererIpc({ ipc, engine, broadcastChanged }: AnswererIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.answerer.onChange(broadcastChanged)

  ipc.handle(answererChannels.get, () => attempt(() => engine.answerer.get()))
  ipc.handle(answererChannels.set, (_event, employeeId) =>
    attempt(() => {
      if (employeeId !== null && typeof employeeId !== 'string') {
        throw new Error('Who answers you is an Employee id, or null for Automatic')
      }
      return engine.answerer.set(employeeId)
    }),
  )
}
