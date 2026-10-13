import {
  NOTE_MAX_BYTES,
  type Note,
  type NoteAuthor,
  type NotesRaw,
  type NotesSearch,
} from '../../../shared/memory/notes'
import type { NotesFiles } from './notes-files'

/**
 * One Employee's note log: a file of lines, appended to and never edited (T193).
 *
 * A line is `<ISO>\t<who>\t<text>`, and a note's id is where its line sits in the file — so the
 * log's length is the next id, and no id is ever reused because no line is ever removed. Nothing
 * rewrites this file; the only write is an append.
 *
 * Reading it is the part that has to hold at a million notes. The offsets of every
 * {@link CHECKPOINT}th line are kept in the closure, built once by a scan in chunks and extended
 * by each append, so reading the newest fifty notes seeks straight to them instead of walking a
 * hundred megabytes. The offsets are derived and never written down: a fresh process scans once.
 */

/** Lines between two remembered offsets. Small enough to seek by, few enough to hold at a million. */
const CHECKPOINT = 256

/** How much of the file a scan reads at a time. Far larger than the longest line can be. */
const CHUNK = 1 << 20

/**
 * How long a search may walk before it answers with what it has. A million notes take a fraction
 * of this; a pattern that backtracks does not, and a main process that stops answering is worse
 * than a search that says it did not reach the end.
 */
const SEARCH_MS = 2_000

const TAB = '\t'
const NEWLINE = 10

export interface NewNote {
  text: string
  by: NoteAuthor
  at: Date
}

export interface NotesLog {
  /** Notes in the log, which is also the id the next one will get. */
  count(): number
  /** Appends one note. Throws when its text is over {@link NOTE_MAX_BYTES}. */
  append(note: NewNote): Note
  /** The notes of `[lo, hi)`, clamped to what the log holds. */
  read(lo: number, hi: number): Note[]
  /** The newest `count` notes, oldest first. */
  tail(count: number): Note[]
  /** Every note whose text matches, newest first, cut to `limit`. Walks the whole file. */
  search(matches: (text: string) => boolean, limit: number, deadline?: number): NotesSearch
  /** The newest `count` lines exactly as the file holds them, for `Raw log`. */
  raw(count: number): NotesRaw
}

export function createNotesLog(files: NotesFiles, path: string): NotesLog {
  /** Bytes of the file that have been scanned into `lines` and `checkpoints`. */
  let scanned = 0
  let lines = 0
  /** `checkpoints[k]` is the byte the note `k * CHECKPOINT` starts at. */
  let checkpoints: number[] = [0]

  function sync(): number {
    const size = files.size(path)
    if (size < scanned) {
      // The file was replaced or truncated under us — a restored Company folder, say. Everything
      // here is derived from it, so the honest answer is to read it again from the start.
      scanned = 0
      lines = 0
      checkpoints = [0]
    }
    while (scanned < size) {
      const chunk = files.readAt(path, scanned, Math.min(CHUNK, size - scanned))
      if (chunk.length === 0) break
      const advanced = index(chunk)
      // No newline in a whole megabyte: the last line has not been finished yet, so there is no
      // further complete line to count.
      if (advanced === 0) break
      scanned += advanced
    }
    return lines
  }

  /** Counts the complete lines in one chunk, and answers how many bytes of it they filled. */
  function index(chunk: Buffer): number {
    let from = 0
    for (;;) {
      const at = chunk.indexOf(NEWLINE, from)
      if (at === -1) return from
      lines++
      if (lines % CHECKPOINT === 0) checkpoints[lines / CHECKPOINT] = scanned + at + 1
      from = at + 1
    }
  }

  /** The lines of `[lo, hi)`, read from the nearest remembered offset rather than from the start. */
  function rowsOf(lo: number, hi: number): string[] {
    if (hi <= lo) return []
    const mark = Math.floor(lo / CHECKPOINT)
    const start = checkpoints[mark] ?? 0
    const end = checkpoints[Math.ceil(hi / CHECKPOINT)] ?? scanned
    const rows = files
      .readAt(path, start, end - start)
      .toString('utf8')
      .split('\n')
    return rows.slice(lo - mark * CHECKPOINT, hi - mark * CHECKPOINT)
  }

  function read(lo: number, hi: number): Note[] {
    const total = sync()
    const from = Math.max(0, lo)
    return rowsOf(from, Math.min(total, hi)).map((row, at) => decode(from + at, row))
  }

  return {
    count: sync,
    append(note) {
      const text = note.text.trim()
      if (text === '') throw new Error('A note cannot be empty')
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > NOTE_MAX_BYTES) {
        throw new Error(
          `A note is at most ${NOTE_MAX_BYTES} bytes and that one is ${bytes}. Split it into two ` +
            'notes rather than shortening it: nothing here is ever deleted, so more lines cost nothing.',
        )
      }
      const id = sync()
      const saved: Note = { id, at: note.at.toISOString(), by: note.by, text }
      const line = encode(saved)
      files.append(path, line)
      lines = id + 1
      scanned += Buffer.byteLength(line, 'utf8')
      if (lines % CHECKPOINT === 0) checkpoints[lines / CHECKPOINT] = scanned
      return saved
    },
    read,
    tail(count) {
      const total = sync()
      return read(Math.max(0, total - count), total)
    },
    search(matches, limit, deadline = SEARCH_MS) {
      sync()
      const until = Date.now() + deadline
      let partial = false
      const end = scanned
      const found: Note[] = []
      let total = 0
      let id = 0
      let at = 0
      // Byte by byte rather than string by string: a chunk boundary can fall inside a multi-byte
      // character, and a decode either side of it would lose that character and the count with it.
      let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      while (at < end) {
        const chunk = files.readAt(path, at, Math.min(CHUNK, end - at))
        if (chunk.length === 0) break
        at += chunk.length
        const buffer = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])
        let from = 0
        for (;;) {
          const newline = buffer.indexOf(NEWLINE, from)
          if (newline === -1) break
          const note = decode(id, buffer.subarray(from, newline).toString('utf8'))
          id++
          from = newline + 1
          if (!matches(note.text)) continue
          total++
          found.push(note)
          if (found.length > limit) found.shift()
        }
        carry = buffer.subarray(from)
        if (Date.now() > until && at < end) {
          partial = true
          break
        }
      }
      return { matches: found.reverse(), total, truncated: total > found.length, partial }
    },
    raw(count) {
      const total = sync()
      const from = Math.max(0, total - count)
      return { text: rowsOf(from, total).join('\n'), total, truncated: from > 0 }
    },
  }
}

/** One line of the log. Tabs and newlines in the text are escaped, so a note is always one line. */
export function encode(note: Note): string {
  return `${note.at}${TAB}${note.by}${TAB}${escapeText(note.text)}\n`
}

/**
 * One line back into a note. A line that is not in the format is still a note — its whole text —
 * because a line is an id, and skipping one would shift every id after it.
 */
export function decode(id: number, line: string): Note {
  const first = line.indexOf(TAB)
  const second = line.indexOf(TAB, first + 1)
  if (first === -1 || second === -1) return { id, at: '', by: 'employee', text: line }
  return {
    id,
    at: line.slice(0, first),
    by: line.slice(first + 1, second) === 'boss' ? 'boss' : 'employee',
    text: unescapeText(line.slice(second + 1)),
  }
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}

function unescapeText(text: string): string {
  return text.replace(/\\([\\nrt])/g, (_, code: string) =>
    code === 'n' ? '\n' : code === 'r' ? '\r' : code === 't' ? '\t' : '\\',
  )
}
