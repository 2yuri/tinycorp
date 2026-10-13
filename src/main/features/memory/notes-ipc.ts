import { notesChannels } from '../../../shared/domain/channels'
import type { NoteRange } from '../../../shared/memory/notes'
import { attempt, type IpcHandlerRegistry, isRecord, requireString } from '../../core'
import type { NotesFacade } from './facade'

export interface NotesIpcOptions {
  ipc: IpcHandlerRegistry
  engine: NotesFacade
}

/**
 * The drawer's Memory tab and the Tokens card's `What Employees remember` (T193). It holds no
 * state: everything is read from the log and the tree, which are the truth.
 *
 * There is no edit and no delete here, and that is the feature rather than an omission — the log
 * is append-only, so the boss's only write is one more note.
 */
export function registerNotesIpc({ ipc, engine }: NotesIpcOptions): void {
  ipc.handle(notesChannels.view, (_event, employeeId) =>
    attempt(() => engine.notes.view(requireString(employeeId, 'Employee id'))),
  )
  ipc.handle(notesChannels.addNote, (_event, employeeId, text) =>
    attempt(() => engine.notes.addNote(requireString(employeeId, 'Employee id'), requireString(text, 'note'))),
  )
  ipc.handle(notesChannels.zoom, (_event, employeeId, range) =>
    attempt(() => engine.notes.zoom(requireString(employeeId, 'Employee id'), rangeInput(range))),
  )
  ipc.handle(notesChannels.search, (_event, employeeId, query) =>
    attempt(() => engine.notes.search(requireString(employeeId, 'Employee id'), requireString(query, 'search'))),
  )
  ipc.handle(notesChannels.raw, (_event, employeeId) =>
    attempt(() => engine.notes.raw(requireString(employeeId, 'Employee id'))),
  )
  ipc.handle(notesChannels.budget, () => attempt(() => engine.notes.budget()))
  ipc.handle(notesChannels.setBudget, (_event, tokens) =>
    attempt(() => engine.notes.setBudget(wholeNumber(tokens, 'Read at session start'))),
  )
}

/** A range off the wire, proved rather than asserted: two whole numbers, the second the larger. */
function rangeInput(value: unknown): NoteRange {
  if (!isRecord(value)) throw new Error('A range is { lo, hi }')
  const lo = wholeNumber(value['lo'], 'The range’s first note')
  const hi = wholeNumber(value['hi'], 'The range’s last note')
  if (hi <= lo) throw new Error(`A range ends after it starts; ${lo}–${hi} does not`)
  return { lo, hi }
}

function wholeNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${what} is a whole number, not ${String(value)}`)
  }
  return value
}
