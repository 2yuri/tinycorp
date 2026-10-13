import type { BoardCommand, BoardSnapshot } from '../../../shared/domain/board'
import { boardChannels } from '../../../shared/domain/channels'
import type { Result } from '../../../shared/domain/result'
import { assertNever } from '../../../shared/platform/assert-never'
import { attemptAsync, type IpcHandlerRegistry } from '../../core'
import type { Board } from './board'
import type { BoardFacade } from './facade'

export interface BoardIpcOptions {
  ipc: IpcHandlerRegistry
  engine: BoardFacade
  broadcastChanged(board: BoardSnapshot | null): void
}

/** Exposes the current Company's board to the renderer. Holds no state of its own. */
export function registerBoardIpc({ ipc, engine, broadcastChanged }: BoardIpcOptions): void {
  const current = () => (engine.currentCompany() ? engine.board().snapshot() : null)
  // Runs inside the engine's change notifications, so it must never throw into them.
  const broadcast = () => {
    let board: BoardSnapshot | null = null
    try {
      board = current()
    } catch (error) {
      console.error('Could not read the board', error)
    }
    broadcastChanged(board)
  }
  engine.onChange(broadcast)
  engine.onBoardChange(broadcast)

  ipc.handle(boardChannels.snapshot, () => current())

  ipc.handle(boardChannels.apply, (_event, command): Result<BoardSnapshot> => {
    try {
      const board = engine.board()
      apply(board, parseCommand(command))
      return { ok: true, value: board.snapshot() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Deleting a ticket (T275): the boss's own action, with no MCP tool behind it. The engine
  // announces the change, so every screen that draws the ticket lets go of it on its own.
  ipc.handle(boardChannels.ticketRemoval, (_event, ticketId) =>
    attemptAsync(async () => engine.ticketRemovals().ticketRemoval(parseTicketId(ticketId))),
  )
  ipc.handle(boardChannels.deleteTicket, (_event, ticketId) =>
    attemptAsync(async () => engine.ticketRemovals().deleteTicket(parseTicketId(ticketId))),
  )
}

/** A ticket id from the renderer: a positive whole number, or a refusal. */
function parseTicketId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error('Missing ticket')
  return value
}

function apply(board: Board, command: BoardCommand): void {
  switch (command.kind) {
    case 'createTarget':
      return void board.createTarget(command.input)
    case 'updateTarget':
      return void board.updateTarget(command.id, command.changes)
    case 'createEpic':
      return void board.createEpic(command.input)
    case 'updateEpic':
      return void board.updateEpic(command.id, command.changes)
    case 'createTicket':
      return void board.createTicket(command.input)
    case 'updateTicket':
      return void board.updateTicket(command.id, command.changes)
    case 'moveTicket':
      return void board.moveTicket(command.id, command.column, command.index)
    case 'createSubtask':
      return void board.createSubtask(command.input)
    case 'updateSubtask':
      return void board.updateSubtask(command.id, command.changes)
    case 'deleteSubtask':
      return void board.deleteSubtask(command.id)
    case 'setWipLimit':
      return void board.setWipLimit(command.column, command.limit)
    case 'addBlocker':
      return void board.addBlocker(command.id, command.blockedById)
    case 'removeBlocker':
      return void board.removeBlocker(command.id, command.blockedById)
    default:
      // A command the board does not answer would otherwise do nothing at all, and the screen that
      // sent it would simply never change.
      assertNever(command, 'board command')
  }
}

const shapes: Record<BoardCommand['kind'], readonly string[]> = {
  createTarget: ['input'],
  updateTarget: ['id', 'changes'],
  createEpic: ['input'],
  updateEpic: ['id', 'changes'],
  createTicket: ['input'],
  updateTicket: ['id', 'changes'],
  moveTicket: ['id', 'column'],
  createSubtask: ['input'],
  updateSubtask: ['id', 'changes'],
  deleteSubtask: ['id'],
  setWipLimit: ['column', 'limit'],
  addBlocker: ['id', 'blockedById'],
  removeBlocker: ['id', 'blockedById'],
}

/**
 * Checks the envelope of a command from the renderer. The board validates the values inside.
 */
function parseCommand(value: unknown): BoardCommand {
  if (!isRecord(value) || typeof value['kind'] !== 'string' || !Object.hasOwn(shapes, value['kind'])) {
    throw new Error('Unknown board command')
  }
  for (const field of shapes[value['kind'] as BoardCommand['kind']]) {
    const part = value[field]
    const ok =
      field === 'input' || field === 'changes'
        ? isRecord(part)
        : field === 'id' || field === 'blockedById'
          ? Number.isInteger(part)
          : field === 'column'
            ? typeof part === 'string'
            : part === null || typeof part === 'number'
    if (!ok) throw new Error(`Malformed board command: ${field}`)
  }
  if (value['index'] !== undefined && !Number.isInteger(value['index'])) {
    throw new Error('Malformed board command: index')
  }
  return value as BoardCommand
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
