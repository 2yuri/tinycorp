import { usageChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import type { IpcHandlerRegistry } from '../../core'
import type { ProviderUsageReader } from './provider-usage'

export interface UsageIpcOptions {
  ipc: IpcHandlerRegistry
  usage: ProviderUsageReader
  broadcastChanged(): void
}

/**
 * Lets the renderer read what each Provider reports of the subscription. The numbers are read
 * here, in the main process, and the login behind them never crosses to the renderer.
 */
export function registerUsageIpc({ ipc, usage, broadcastChanged }: UsageIpcOptions): void {
  usage.onChange(broadcastChanged)

  ipc.handle(usageChannels.read, () => attempt(() => usage.read()))
  ipc.handle(usageChannels.refresh, () => attempt(() => usage.refresh()))
}

async function attempt<T>(action: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await action() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
