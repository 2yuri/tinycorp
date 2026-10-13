import type { PtySession } from '../../providers'

/** How much recent output a terminal replays when it is opened, in characters. */
export const BACKLOG_LIMIT = 256 * 1024
/** Full terminal reset: an attached terminal is cleared when its Employee's Session restarts. */
export const TERMINAL_RESET = '\x1bc'

export interface AttachedTerminal {
  /** Recent output of the Employee's current or last Session. */
  backlog: string
  detach(): void
}

/** The live terminals of Employees' Sessions: output fan-out, input and size. */
export interface Terminals {
  /**
   * Streams an Employee's terminal output to `listener`, across Session restarts,
   * after replaying what is already on screen as `backlog`.
   */
  attach(employeeId: string, listener: (data: string) => void): AttachedTerminal
  /** Types `data` into the Employee's running Session. Does nothing when none is running. */
  write(employeeId: string, data: string): void
  /** Resizes the Employee's PTY, now and for Sessions started later. */
  resize(employeeId: string, cols: number, rows: number): void
}

/** Terminals plus the engine-side wiring. */
export interface TerminalRegistry extends Terminals {
  /** Called by Sessions whenever an Employee's PTY is spawned. */
  track(employeeId: string, pty: PtySession): void
  /** Forgets every terminal. */
  clear(): void
}

interface Terminal {
  pty: PtySession | null
  backlog: string
  size: { cols: number; rows: number } | null
  listeners: Set<(data: string) => void>
  detach: (() => void)[]
}

export function createTerminals(): TerminalRegistry {
  const terminals = new Map<string, Terminal>()

  function terminal(employeeId: string): Terminal {
    let found = terminals.get(employeeId)
    if (!found) {
      found = { pty: null, backlog: '', size: null, listeners: new Set(), detach: [] }
      terminals.set(employeeId, found)
    }
    return found
  }

  function emit(entry: Terminal, data: string): void {
    for (const listener of entry.listeners) listener(data)
  }

  function unplug(entry: Terminal): void {
    for (const detach of entry.detach.splice(0)) detach()
    entry.pty = null
  }

  return {
    attach(employeeId, listener) {
      const entry = terminal(employeeId)
      entry.listeners.add(listener)
      return { backlog: entry.backlog, detach: () => void entry.listeners.delete(listener) }
    },

    write(employeeId, data) {
      terminals.get(employeeId)?.pty?.write(data)
    },

    resize(employeeId, cols, rows) {
      if (!isCellCount(cols) || !isCellCount(rows)) {
        throw new Error(`Invalid terminal size: ${cols}×${rows}`)
      }
      const entry = terminal(employeeId)
      entry.size = { cols, rows }
      entry.pty?.resize(cols, rows)
    },

    track(employeeId, pty) {
      const entry = terminal(employeeId)
      unplug(entry)
      entry.pty = pty
      if (entry.backlog) emit(entry, TERMINAL_RESET)
      entry.backlog = ''
      if (entry.size) pty.resize(entry.size.cols, entry.size.rows)
      entry.detach.push(
        pty.onData((data) => {
          if (entry.pty !== pty) return
          entry.backlog = trimBacklog(entry.backlog + data)
          emit(entry, data)
        }),
        pty.onExit(() => {
          if (entry.pty === pty) unplug(entry)
        }),
      )
    },

    clear() {
      for (const entry of terminals.values()) {
        unplug(entry)
        entry.listeners.clear()
      }
      terminals.clear()
    },
  }
}

function isCellCount(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 10_000
}

/** Keeps the last BACKLOG_LIMIT characters, starting at a line break when there is one nearby. */
function trimBacklog(text: string): string {
  if (text.length <= BACKLOG_LIMIT) return text
  const cut = text.length - BACKLOG_LIMIT
  const newline = text.indexOf('\n', cut)
  return newline !== -1 && newline - cut < 4096 ? text.slice(newline + 1) : text.slice(cut)
}
