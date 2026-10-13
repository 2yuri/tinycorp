import { preflightChannels } from '../../shared/domain/channels'
import type { Result } from '../../shared/domain/result'
import type { IpcHandlerRegistry } from '../core'
import type { Preflight } from './preflight'

export interface PreflightIpcOptions {
  ipc: IpcHandlerRegistry
  preflight: Preflight
}

/**
 * Serves the preflight cards (T129, T135): the answers the app started with, and the ones
 * `Check again` asks for. `status` never spawns — the main process asked before the Launcher drew.
 */
export function registerPreflightIpc({ ipc, preflight }: PreflightIpcOptions): void {
  ipc.handle(preflightChannels.status, () => preflight.status())
  ipc.handle(preflightChannels.all, () => preflight.all())
  ipc.handle(preflightChannels.recheck, () => attempt(() => preflight.recheck()))
}

async function attempt<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
