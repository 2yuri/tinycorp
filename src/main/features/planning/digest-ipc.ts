import { digestChannels } from '../../../shared/domain/channels'
import type { DigestScheduleUpdate } from '../../../shared/planning/daily-digest'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { DigestFacade } from './wire'

export interface DigestIpcOptions {
  ipc: IpcHandlerRegistry
  engine: DigestFacade
  broadcastChanged(): void
}

/**
 * Lets Company settings read and change when the daily digest posts (T172). What the digest says
 * is never asked for here: the engine writes it on its own schedule and it arrives in chat like
 * any other message.
 */
export function registerDigestIpc({ ipc, engine, broadcastChanged }: DigestIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.digest.onPosted(broadcastChanged)

  ipc.handle(digestChannels.schedule, () => attempt(() => engine.digest.schedule()))
  ipc.handle(digestChannels.setSchedule, (_event, update) => {
    const result = attempt(() => engine.digest.setSchedule((update ?? {}) as DigestScheduleUpdate))
    if (result.ok) broadcastChanged()
    return result
  })
}
