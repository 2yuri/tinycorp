import { spawnSettingsChannels } from '../../../shared/domain/channels'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { SpawnSettingsFacade } from './facade'

export interface SpawnSettingsIpcOptions {
  ipc: IpcHandlerRegistry
  engine: SpawnSettingsFacade
  broadcastChanged(): void
}

/**
 * The settings cards' two calls about what a Session baked in at its spawn (T237): who is still on
 * the old setting, and `Apply now`.
 *
 * The event fires when a Session moves — one restarts, one stops, one finishes its turn — because
 * that is when somebody stops being behind. The boss's own change is not a Session event and does
 * not fire it: the card that wrote the setting reads this again itself, which it can, because the
 * engine had already answered it by the time the write returned.
 */
export function registerSpawnSettingsIpc({ ipc, engine, broadcastChanged }: SpawnSettingsIpcOptions): void {
  engine.spawnSettings.onChange(broadcastChanged)

  ipc.handle(spawnSettingsChannels.stale, () => attempt(() => engine.spawnSettings.stale()))
  ipc.handle(spawnSettingsChannels.applyNow, () => attempt(() => engine.spawnSettings.applyNow()))
}
