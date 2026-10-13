import { join } from 'node:path'
import {
  aligned,
  NOTES_LEAF,
  type NoteRange,
  type NoteSummary,
  parseRangeKey,
  rangeKey,
  rangeLabel,
} from '../../../shared/memory/notes'
import type { NotesFiles } from './notes-files'

/**
 * The summaries over an Employee's note log (T193): one file per aligned range, in `tree/`.
 *
 * It is a cache and nothing else. Every file here can be thrown away and written again from the
 * log, which is why `forget` is a delete and not an edit, and why nothing in the wake breaks when
 * a summary is missing — a range nobody has written is a range the wake names and the Employee can
 * zoom into.
 *
 * A file is `tree/<lo>-<hi>.md`, its first line the ISO time it was written and the rest the
 * summary. The name is the range, so a folder listing is the whole index and no second file has to
 * be kept in step with it.
 */

const STAMP = /^(\S+)\n?/

export interface NotesTree {
  /** The summary of exactly that range, or null when nobody has written it. */
  get(range: NoteRange): NoteSummary | null
  /** Whether that exact range is written, without reading the file. The wake asks this a lot. */
  has(range: NoteRange): boolean
  /** Whether any summary in the tree covers a range inside `range` — the wake's descent test. */
  holdsInside(range: NoteRange): boolean
  /** Writes or replaces one range's summary. Throws when the range is not one a summary may cover. */
  put(range: NoteRange, text: string, at: Date): NoteSummary
  /** Drops a summary so it gets written again. Answers whether there was one. */
  drop(range: NoteRange): boolean
  /** Every summary the tree holds, oldest range first. */
  list(): NoteSummary[]
  count(): number
}

export function createNotesTree(files: NotesFiles, folder: string): NotesTree {
  /**
   * The folder listing, kept between calls: one wake asks `holdsInside` once per level it descends
   * through, and listing a folder twenty times to answer the same question is the difference
   * between a wake that is free and one that is not.
   */
  let known: NoteRange[] | null = null

  function ranges(): NoteRange[] {
    known ??= files
      .list(folder)
      .flatMap((name) => {
        const range = name.endsWith('.md') ? parseRangeKey(name.slice(0, -3)) : null
        return range ? [range] : []
      })
      .sort((a, b) => a.lo - b.lo || a.hi - b.hi)
    return known
  }

  function pathOf(range: NoteRange): string {
    return join(folder, `${rangeKey(range)}.md`)
  }

  function read(range: NoteRange): NoteSummary | null {
    const content = files.read(pathOf(range))
    if (content === null) return null
    const stamp = STAMP.exec(content)
    return {
      range,
      at: stamp?.[1] ?? '',
      text: content.slice(stamp?.[0].length ?? 0).trim(),
    }
  }

  /** The same ranges as a set of keys, for the one question the wake asks tens of thousands of times. */
  let keys: Set<string> | null = null

  return {
    get: (range) => (aligned(range) ? read(range) : null),
    has(range) {
      keys ??= new Set(ranges().map(rangeKey))
      return keys.has(rangeKey(range))
    },
    holdsInside(range) {
      // The listing is sorted by `lo`, so the first summary that could be inside is the first one
      // starting at or after `lo`; anything before it starts earlier and so is not inside.
      const all = ranges()
      let low = 0
      let high = all.length
      while (low < high) {
        const middle = (low + high) >> 1
        if ((all[middle]?.lo ?? 0) < range.lo) low = middle + 1
        else high = middle
      }
      for (let at = low; at < all.length; at++) {
        const one = all[at]
        if (!one || one.lo >= range.hi) break
        if (one.hi <= range.hi) return true
      }
      return false
    },
    put(range, text, at) {
      if (!aligned(range)) throw new Error(rangeRefusal(range))
      const summary = text.trim()
      if (summary === '') throw new Error('A summary cannot be empty')
      const stamp = at.toISOString()
      files.write(pathOf(range), `${stamp}\n${summary}\n`)
      known = null
      keys = null
      return { range, at: stamp, text: summary }
    },
    drop(range) {
      if (!aligned(range)) throw new Error(rangeRefusal(range))
      const had = files.read(pathOf(range)) !== null
      files.remove(pathOf(range))
      known = null
      keys = null
      return had
    },
    list() {
      return ranges().flatMap((range) => {
        const summary = read(range)
        return summary ? [summary] : []
      })
    },
    count: () => ranges().length,
  }
}

/**
 * Why a range is not one a summary may cover, said with the arithmetic in it. An Employee that
 * guessed `#96–110` has to be told what a real range looks like, not that its input was invalid.
 */
export function rangeRefusal(range: NoteRange): string {
  const size = range.hi - range.lo
  return (
    `${rangeLabel(range)} is not a range a summary covers. A range holds a power of two notes, at ` +
    `least ${NOTES_LEAF}, and starts on its own multiple — #0–7, #8–15, #0–15, #16–31, #0–31. ` +
    `That one holds ${size}.`
  )
}
