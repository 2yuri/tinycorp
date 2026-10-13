import { terminalChannels } from '../../../shared/domain/channels'
import { attempt, attemptAsync, requireString } from '../../core'
import type { TerminalsFacade } from './facade'

/** The slice of Electron's `WebContents` a terminal streams to. */
export interface TerminalSender {
  id: number
  send(channel: string, employeeId: string, data: string): void
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): void
}

/** The slice of Electron's `ipcMain` this module needs; handlers see the calling window. */
export interface TerminalIpcRegistry {
  handle(channel: string, handler: (event: { sender: TerminalSender }, ...args: unknown[]) => unknown): void
}

export interface TerminalIpcOptions {
  ipc: TerminalIpcRegistry
  engine: TerminalsFacade
  /**
   * The system clipboard as text, for a right-click that pastes (T249). It is read here because
   * the window refuses every permission request it is asked (`window-policy.ts`), so
   * `navigator.clipboard.readText()` in the renderer is denied in a packaged build; the text goes
   * back to xterm rather than straight into the PTY, because xterm is what knows whether the
   * program on the other end asked for bracketed paste.
   *
   * Defaults to nothing, which is what a test and a headless harness get. Electron's own read is
   * a promise, so this one is too.
   */
  readClipboard?: () => string | Promise<string>
}

/**
 * Connects renderer terminals to Employees' PTYs. Each window gets at most one stream
 * per Employee, dropped when the window detaches or is destroyed.
 */
export function registerTerminalIpc({ ipc, engine, readClipboard = () => '' }: TerminalIpcOptions): void {
  /** Detach functions by window id, then Employee id. */
  const streams = new Map<number, Map<string, () => void>>()

  function streamsOf(sender: TerminalSender): Map<string, () => void> {
    let found = streams.get(sender.id)
    if (!found) {
      const created = new Map<string, () => void>()
      streams.set(sender.id, created)
      sender.once('destroyed', () => {
        for (const detach of created.values()) detach()
        streams.delete(sender.id)
      })
      found = created
    }
    return found
  }

  function detach(sender: TerminalSender, employeeId: string): void {
    const bySender = streams.get(sender.id)
    bySender?.get(employeeId)?.()
    bySender?.delete(employeeId)
  }

  ipc.handle(terminalChannels.attach, ({ sender }, employeeId) =>
    attempt(() => {
      const id = requireString(employeeId, 'Employee id')
      if (!engine.employees.list().some((e) => e.id === id)) {
        throw new Error(`Unknown Employee: ${id}`)
      }
      detach(sender, id)
      const attached = engine.terminals.attach(id, (data) => {
        if (!sender.isDestroyed()) sender.send(terminalChannels.data, id, data)
      })
      streamsOf(sender).set(id, attached.detach)
      return attached.backlog
    }),
  )

  ipc.handle(terminalChannels.detach, ({ sender }, employeeId) =>
    attempt(() => {
      detach(sender, requireString(employeeId, 'Employee id'))
      return null
    }),
  )

  ipc.handle(terminalChannels.write, (_event, employeeId, data) =>
    attempt(() => {
      const id = requireString(employeeId, 'Employee id')
      if (typeof data !== 'string') throw new Error('Terminal input must be text')
      engine.terminals.write(id, data)
      return null
    }),
  )

  ipc.handle(terminalChannels.clipboard, () => attemptAsync(async () => await readClipboard()))

  ipc.handle(terminalChannels.resize, (_event, employeeId, cols, rows) =>
    attempt(() => {
      const id = requireString(employeeId, 'Employee id')
      if (typeof cols !== 'number' || typeof rows !== 'number') {
        throw new Error('A terminal size is two numbers')
      }
      engine.terminals.resize(id, cols, rows)
      return null
    }),
  )
}
