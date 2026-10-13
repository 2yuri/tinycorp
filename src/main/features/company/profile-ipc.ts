import type { BossUpdate } from '../../../shared/boss-profile'
import { profileChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { BossFacade } from './facade'

export interface ProfileIpcOptions {
  ipc: IpcHandlerRegistry
  engine: BossFacade
  broadcastChanged(): void
  /** Every Company shows the boss, so a profile change is a Company change too. */
  broadcastCompanyChanged(): void
}

/** Lets Your profile read and write the one boss profile. Holds no state of its own. */
export function registerProfileIpc({
  ipc,
  engine,
  broadcastChanged,
  broadcastCompanyChanged,
}: ProfileIpcOptions): void {
  engine.boss.onChanged(() => {
    broadcastChanged()
    broadcastCompanyChanged()
  })

  ipc.handle(profileChannels.get, () => attempt(() => engine.boss.get()))
  ipc.handle(profileChannels.update, (_event, update) =>
    attempt(() => {
      if (!update || typeof update !== 'object') throw new Error('A profile update must be an object')
      return engine.boss.update(update as BossUpdate)
    }),
  )
}
