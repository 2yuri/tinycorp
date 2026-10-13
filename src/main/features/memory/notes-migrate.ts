import { NOTE_MAX_BYTES } from '../../../shared/memory/notes'
import type { NewNote } from './notes-log'

/**
 * The one-time move from T73's memory file to T193's log.
 *
 * The old file was one markdown document the Employee rewrote whole, capped at 32,000 characters,
 * which is why it had to delete to write. Its entries become notes, oldest first, one note per
 * entry and more than one where an entry is longer than a note may be — so nothing in it is lost,
 * which is the whole point of the log that replaces it.
 *
 * The parser is deliberately forgiving: this reads files real Employees wrote over months against
 * instructions that changed twice, so anything that is a line of text becomes a note rather than
 * being dropped for not being the shape the parser hoped for. The file itself is kept as
 * `<id>.md.bak` either way, so a bad read is a file the boss still has.
 */

const HEADING = /^#{1,6}\s+(.*\S)\s*$/
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/
/** `_Learned on TC-118 · written by Nova · 2026-09-15_`, the source line T73 asked entries to end with. */
const SOURCE = /^\s*[_*]\s*([^_*].*?)\s*[_*]\s*$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

/** One entry of the old file, ready to be appended. */
export type MigratedNote = Omit<NewNote, 'at'> & { at: Date | null }

/**
 * The old file as notes, oldest first. The file was written newest-last, so its own order is the
 * order the log wants.
 */
export function notesFromMarkdown(content: string | null): MigratedNote[] {
  if (!content || content.trim() === '') return []
  const notes: MigratedNote[] = []
  let section: string | null = null

  for (const block of blocks(content)) {
    const title = HEADING.exec(block[0] ?? '')?.[1] ?? null
    if (title !== null) {
      section = title
      // A heading with nothing under it labels what follows; it is not a note of its own.
      if (block.length === 1) continue
    }
    const body = title === null ? block : block.slice(1)
    const { text, source } = split(body)
    const prose = text === '' ? (title ?? '') : text
    if (prose.trim() === '') continue

    const by = /added by/i.test(source ?? '') || /boss/i.test(section ?? '') ? 'boss' : 'employee'
    const at = when(source)
    // The section is what made an entry a Lesson or a Convention in the drawer; the log has no
    // sections, so it goes into the note's own words or it is gone.
    const prefixed = section && title === null ? `${section}: ${prose}` : prose
    for (const piece of pieces(prefixed)) notes.push({ text: piece, by, at })
  }
  return notes
}

/** The lines of the file in blocks: a heading or a bullet starts one, a blank line ends one. */
function blocks(content: string): string[][] {
  const lines = content.split('\n')
  const out: string[][] = []
  const line = (at: number) => lines[at] ?? ''
  let at = 0
  while (at < lines.length) {
    if (line(at).trim() === '') {
      at++
      continue
    }
    const start = at
    at++
    while (at < lines.length && line(at).trim() !== '' && !HEADING.test(line(at)) && !BULLET.test(line(at))) at++
    const block = lines.slice(start, at)
    const bullet = BULLET.exec(block[0] ?? '')?.[1]
    out.push(bullet === undefined ? block : [bullet, ...block.slice(1).map((one) => one.trim())])
  }
  return out
}

/** A block's text and its source line, when the last line is one and there is text above it. */
function split(body: string[]): { text: string; source: string | null } {
  const last = body.at(-1)
  const source = last === undefined ? null : (SOURCE.exec(last)?.[1] ?? null)
  if (source !== null && body.length > 1) return { text: body.slice(0, -1).join(' ').trim(), source }
  return { text: body.join(' ').trim(), source: null }
}

/** The day the source line names, or null when it names none. */
function when(source: string | null): Date | null {
  const day = source
    ?.split('·')
    .map((part) => part.trim())
    .find((part) => ISO_DATE.test(part))
  if (!day) return null
  const parsed = new Date(day)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * One entry as one or more notes. A note is at most {@link NOTE_MAX_BYTES} bytes, so an entry
 * longer than that is split at a sentence end where there is one and at a space otherwise —
 * never mid-word, and never dropped.
 */
export function pieces(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return []
  if (Buffer.byteLength(flat, 'utf8') <= NOTE_MAX_BYTES) return [flat]

  const out: string[] = []
  let rest = flat
  while (Buffer.byteLength(rest, 'utf8') > NOTE_MAX_BYTES) {
    const head = cut(rest)
    out.push(head.trim())
    rest = rest.slice(head.length).trim()
  }
  if (rest !== '') out.push(rest)
  return out
}

/** The longest head of `text` that fits, ending at a sentence if it can and at a space if it must. */
function cut(text: string): string {
  let head = text
  while (Buffer.byteLength(head, 'utf8') > NOTE_MAX_BYTES) head = head.slice(0, -1)
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('; '))
  if (sentence > NOTE_MAX_BYTES / 2) return head.slice(0, sentence + 1)
  const space = head.lastIndexOf(' ')
  // A single word longer than a note: it is cut where it fits, because losing it is worse.
  return space > 0 ? head.slice(0, space) : head
}
