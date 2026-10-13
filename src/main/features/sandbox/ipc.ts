import { sandboxChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { SandboxView } from '../../../shared/sandbox/ipc'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { SandboxFacade } from './wire'

export interface SandboxIpcOptions {
  ipc: IpcHandlerRegistry
  engine: SandboxFacade
  broadcastChanged(): void
}

/**
 * The Add-ons tab's half of the Sandbox add-on (T260): reading where ai-jail stands, pressing
 * `Check again`, and the one toggle.
 *
 * It holds no state, and nothing here installs ai-jail — it is GPL-3.0-only, so the boss runs one
 * line in their own terminal and this asks the machine again.
 */
export function registerSandboxIpc({ ipc, engine, broadcastChanged }: SandboxIpcOptions): void {
  engine.sandbox.onChange(broadcastChanged)

  const view = (): SandboxView => ({
    status: engine.sandbox.cached(),
    settings: engine.sandbox.settings(),
    install: engine.sandbox.install(),
  })

  ipc.handle(sandboxChannels.read, () =>
    // Detects once and remembers; every read after the first is the cached answer.
    settle(async () => {
      await engine.sandbox.status()
      return view()
    }),
  )
  ipc.handle(sandboxChannels.recheck, () =>
    settle(async () => {
      await engine.sandbox.recheck()
      return view()
    }),
  )
  ipc.handle(sandboxChannels.setEnabled, (_event, enabled) =>
    attempt(() => {
      if (typeof enabled !== 'boolean') throw new Error('The Sandbox add-on is on or off')
      return engine.sandbox.setSettings({ enabled })
    }),
  )
}

/** `attempt`, for the two answers that come back from a subprocess rather than from a table. */
async function settle<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
