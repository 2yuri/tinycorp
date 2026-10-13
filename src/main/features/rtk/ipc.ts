import { rtkChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { RtkView } from '../../../shared/ipc'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { RtkFacade } from './wire'

export interface RtkIpcOptions {
  ipc: IpcHandlerRegistry
  engine: RtkFacade
  broadcastChanged(): void
}

/**
 * The Tokens tab's half of RTK (T179): reading where it stands, pressing `Check again`, the two
 * toggles, and what it says was saved.
 *
 * It holds no state. Nothing here installs RTK, runs `rtk init`, or writes anything outside the
 * app's own folder — the boss runs one line in their own terminal, and this asks the machine again.
 */
export function registerRtkIpc({ ipc, engine, broadcastChanged }: RtkIpcOptions): void {
  engine.rtk.onChange(broadcastChanged)

  const view = (): RtkView => ({
    status: engine.rtk.cached(),
    settings: engine.rtk.settings(),
    hooks: engine.rtk.rows(),
  })

  ipc.handle(rtkChannels.read, () =>
    // Detects once and remembers; every read after the first is the cached answer.
    settle(async () => {
      await engine.rtk.status()
      return view()
    }),
  )
  ipc.handle(rtkChannels.recheck, () =>
    settle(async () => {
      await engine.rtk.recheck()
      return view()
    }),
  )
  ipc.handle(rtkChannels.setEnabled, (_event, enabled) =>
    attempt(() => {
      if (typeof enabled !== 'boolean') throw new Error('Compress command output is on or off')
      return engine.rtk.setSettings({ enabled })
    }),
  )
  ipc.handle(rtkChannels.setPing, (_event, ping) =>
    attempt(() => {
      if (typeof ping !== 'boolean') throw new Error('The daily ping is on or off')
      return engine.rtk.setSettings({ ping })
    }),
  )
  ipc.handle(rtkChannels.savings, () => settle(() => engine.rtk.savings()))
}

/** `attempt`, for the two answers that come back from a subprocess rather than from a table. */
async function settle<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
