import {
  aligned,
  NOTES_LEAF,
  type Note,
  type NoteAuthor,
  type NoteRange,
  type NoteSummary,
  type NotesNode,
  type NotesRaw,
  type NotesSearch,
  type NotesView,
  type NotesWake,
  type NotesZoom,
  rangeLabel,
  rangeSize,
} from '../../../shared/memory/notes'
import { legacyNotesPath, type NotesFiles, notesLogPath, notesTreeFolder } from './notes-files'
import { createNotesLog } from './notes-log'
import { notesFromMarkdown } from './notes-migrate'
import { createNotesTree, rangeRefusal } from './notes-tree'
import { dueSummary, planWake } from './notes-wake'

/**
 * One Employee's notes: an append-only log, a tree of summaries over it, and the fixed-size wake
 * a Session starts with (T193).
 *
 * Nothing here deletes a note, and nothing here edits one. `forget` drops a *summary*, which is a
 * cache; the notes under it are exactly where they were. That is the property the whole feature is
 * for: the Employee never has to choose what to lose in order to write down one more thing.
 *
 * It is made once per Employee per open Company and kept, because the log's read index lives in
 * its closure: throwing it away between two calls would mean walking the file again.
 */

/** How many notes `Raw log` shows, and how many matches a search answers with. */
export const NOTES_RAW_LINES = 500
export const NOTES_SEARCH_LIMIT = 100

export interface EmployeeNotes {
  /** What a Session reads at spawn, inside the Company's budget. */
  wake(budget: number): NotesWake
  /** The summary the Employee owes next, or null when the tree is complete. */
  due(): NoteRange | null
  /** Appends one note. Refuses text over 280 bytes, with the limit in the message. */
  add(text: string, by: NoteAuthor): Note
  /** The drawer's Memory tab in one read. */
  view(budget: number): NotesView
  /** One node opened: its two halves, or the notes themselves at the leaf. */
  zoom(range: NoteRange): NotesZoom
  /** Every note that matches, newest first. Walks the whole log. */
  search(pattern: RegExp, limit?: number): NotesSearch
  /** Writes a due summary. */
  nap(range: NoteRange, summary: string): NoteSummary
  /** Drops a summary so it is written again. */
  forget(range: NoteRange): boolean
  /** The tail of the log as it is on disk. */
  raw(): NotesRaw
  notes(): number
  summaries(): number
}

export interface NotesOptions {
  files: NotesFiles
  companyFolder: string
  employeeId: string
  now(): Date
}

export function employeeNotes({ files, companyFolder, employeeId, now }: NotesOptions): EmployeeNotes {
  const path = notesLogPath(companyFolder, employeeId)
  const log = createNotesLog(files, path)
  const tree = createNotesTree(files, notesTreeFolder(companyFolder, employeeId))
  let migrated = false

  /**
   * T73's file, read into the log the first time anything asks — once, because the file is moved
   * aside as it is read and a Company that never had one has nothing to move.
   */
  function migrate(): void {
    if (migrated) return
    migrated = true
    if (log.count() > 0) return
    const legacy = legacyNotesPath(companyFolder, employeeId)
    const content = files.read(legacy)
    if (content === null) return
    for (const note of notesFromMarkdown(content)) {
      log.append({ text: note.text, by: note.by, at: note.at ?? now() })
    }
    files.rename(legacy, `${legacy}.bak`)
  }

  const source = () => {
    migrate()
    return {
      total: log.count(),
      notes: (lo: number, hi: number) => log.read(lo, hi),
      summary: (range: NoteRange) => tree.get(range),
      has: (range: NoteRange) => tree.has(range),
      holdsInside: (range: NoteRange) => tree.holdsInside(range),
    }
  }

  /** One range as the drawer draws it: its summary when there is one, and the days it spans. */
  function node(range: NoteRange): NotesNode {
    const summary = tree.get(range)
    const first = log.read(range.lo, range.lo + 1)[0]
    const last = log.read(range.hi - 1, range.hi)[0]
    return {
      range,
      text: summary?.text ?? null,
      at: summary?.at ?? null,
      from: first?.at || null,
      to: last?.at || null,
    }
  }

  function checked(range: NoteRange): NoteRange {
    if (aligned(range)) return range
    throw new Error(rangeRefusal(range))
  }

  return {
    wake: (budget) => planWake(source(), { budget }),
    due: () => dueSummary(source()),
    add(text, by) {
      migrate()
      return log.append({ text, by, at: now() })
    },
    view(budget) {
      const wake = planWake(source(), { budget })
      const recent: Note[] = []
      const earlier: NotesNode[] = []
      for (const item of wake.items) {
        if (item.kind === 'note') recent.push(item.note)
        else earlier.push(node(item.range))
      }
      return {
        // Newest first in the drawer, which reads downwards, where the prompt reads upwards.
        recent: recent.reverse(),
        earlier: earlier.reverse(),
        tokens: wake.tokens,
        budget,
        notes: log.count(),
        summaries: tree.count(),
        due: wake.due,
      }
    },
    zoom(range) {
      migrate()
      const total = log.count()
      if (range.hi > total && range.lo >= total) {
        throw new Error(`There are ${total} notes, so ${rangeLabel(range)} is not in the log yet.`)
      }
      if (rangeSize(range) <= NOTES_LEAF || !aligned(range)) {
        return { range, notes: log.read(range.lo, Math.min(range.hi, total)), nodes: [] }
      }
      const middle = range.lo + rangeSize(range) / 2
      return {
        range,
        notes: [],
        nodes: [node({ lo: range.lo, hi: middle }), node({ lo: middle, hi: range.hi })],
      }
    },
    search(pattern, limit = NOTES_SEARCH_LIMIT) {
      migrate()
      return log.search((text) => {
        // A shared regex keeps `lastIndex` between calls when it is global; resetting it is
        // cheaper than compiling a second one and is what makes two searches agree.
        pattern.lastIndex = 0
        return pattern.test(text)
      }, limit)
    },
    nap(range, summary) {
      migrate()
      const within = checked(range)
      const total = log.count()
      if (within.hi > total) {
        throw new Error(
          `${rangeLabel(within)} is not finished: the log holds ${total} notes. Summarise a range ` +
            'that is complete, and this one when it is.',
        )
      }
      return tree.put(within, summary, now())
    },
    forget: (range) => tree.drop(checked(range)),
    raw: () => {
      migrate()
      return log.raw(NOTES_RAW_LINES)
    },
    notes: () => {
      migrate()
      return log.count()
    },
    summaries: () => tree.count(),
  }
}
