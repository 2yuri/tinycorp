import { codeChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { CodeFacade } from './facade'

export interface CodeIpcOptions {
  ipc: IpcHandlerRegistry
  engine: CodeFacade
  broadcastChanged(): void
}

/** Lets the renderer read tickets' worktrees and PRs. Holds no state of its own. */
export function registerCodeIpc({ ipc, engine, broadcastChanged }: CodeIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.code.onChange(broadcastChanged)

  ipc.handle(codeChannels.list, () => attempt(() => engine.code.list()))
  ipc.handle(codeChannels.details, async (_event, ticketId) => {
    try {
      return { ok: true, value: await engine.code.details(requireTicketId(ticketId)) } satisfies Result<unknown>
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Result<unknown>
    }
  })
}

function requireTicketId(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error('Missing ticket id')
  return value as number
}
