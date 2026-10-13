import { describe, expect, it } from 'vitest'
import { NOTE_MAX_BYTES, type NoteRange, rangeLabel, type WakeItem } from '../../../shared/memory/notes'
import { inMemoryNotesFiles, onDisk } from '../../core/testing'
import { employeeNotes } from './notes'
import { legacyNotesPath } from './notes-files'
import { renderWake } from './notes-wake'

/**
 * An Employee's own notes as the app works them: append a line, read the wake back, summarise what
 * scrolled out, and find any note ever written.
 *
 * The one thing every test here is really about is the promise in the footer — *nothing ever
 * deleted*. T73's file made an Employee choose what to lose in order to write one more thing; if
 * any of these starts passing while a note has gone, this feature is back to being that file.
 */

const FOLDER = onDisk('/work/acme')
const NOW = new Date('2026-09-21T10:00:00Z')

function notesFor(files = inMemoryNotesFiles(), now: () => Date = () => NOW) {
  return { files, notes: employeeNotes({ files, companyFolder: FOLDER, employeeId: 'emp-1', now }) }
}

/** `count` notes, each one long enough to be worth a line and short enough to be a legal one. */
function fill(notes: ReturnType<typeof notesFor>['notes'], count: number, from = 0): void {
  for (let at = from; at < from + count; at++)
    notes.add(`note ${at}: the suite hangs at 90% on this machine`, 'employee')
}

describe('An Employee’s notes', () => {
  it('gives every note an id that is where it sits in the log, and never reuses one', () => {
    const { notes } = notesFor()

    const first = notes.add('billing-api migrations are named <area>-<what>', 'employee')
    const second = notes.add('web-app vitest needs --pool=threads here', 'employee')

    expect([first.id, second.id]).toEqual([0, 1])
    expect(notes.notes()).toBe(2)
  })

  it('refuses a note over the limit, and says what the limit is and what to do instead', () => {
    const { notes } = notesFor()
    const long = 'x'.repeat(NOTE_MAX_BYTES + 1)

    expect(() => notes.add(long, 'employee')).toThrow(/280 bytes and that one is 281/)
    expect(() => notes.add(long, 'employee')).toThrow(/Split it into two notes/)
    expect(notes.notes()).toBe(0)
  })

  it('counts the bytes of a note and not its characters, so an accent is not a free byte', () => {
    const { notes } = notesFor()

    // 140 two-byte characters: 280 bytes exactly, and one more is over.
    expect(() => notes.add('é'.repeat(140), 'employee')).not.toThrow()
    expect(() => notes.add('é'.repeat(141), 'employee')).toThrow(/282/)
  })

  it('keeps a note’s own words through a tab and a newline, which the line format escapes', () => {
    const { notes } = notesFor()

    notes.add('run\tpnpm test\nthen read the tail', 'employee')

    expect(notes.view(4_000).recent[0]?.text).toBe('run\tpnpm test\nthen read the tail')
  })

  it('badges the boss’s own note, so the drawer and the wake both say who wrote it', () => {
    const { notes } = notesFor()

    notes.add('Ship small PRs.', 'boss')

    expect(notes.view(4_000).recent[0]?.by).toBe('boss')
    expect(renderWake(notes.wake(4_000).items)).toContain('(from the boss) Ship small PRs.')
  })
})

describe('The wake', () => {
  it('reads nothing at all for an Employee that has written nothing', () => {
    const { notes } = notesFor()

    const wake = notes.wake(4_000)

    expect(wake).toMatchObject({ items: [], total: 0, tokens: 0, due: null })
  })

  it('reads every note word for word while they all fit', () => {
    const { notes } = notesFor()
    fill(notes, 10)

    const wake = notes.wake(4_000)

    expect(wake.items.filter((item) => item.kind === 'note')).toHaveLength(10)
    expect(wake.tokens).toBeLessThanOrEqual(4_000)
  })

  it('stays inside the budget at ten thousand notes, and covers all of them', () => {
    const { notes } = notesFor()
    fill(notes, 10_000)

    const wake = notes.wake(4_000)

    expect(wake.total).toBe(10_000)
    expect(wake.tokens).toBeLessThanOrEqual(4_000)
    expect(covered(wake.items)).toBe(10_000)
  })

  it('reads more when the boss gives it more, and less when they give it less', () => {
    const { notes } = notesFor()
    fill(notes, 10_000)

    const small = notes.wake(2_000)
    const large = notes.wake(8_000)

    expect(small.tokens).toBeLessThanOrEqual(2_000)
    expect(large.tokens).toBeLessThanOrEqual(8_000)
    expect(large.tokens).toBeGreaterThan(small.tokens)
  })

  it('spends its lines on summaries once they are written, not on ranges it cannot read', () => {
    const { notes } = notesFor()
    fill(notes, 512)
    summariseAll(notes, 512)

    const wake = notes.wake(2_000)

    // A handful of lines for the four hundred notes behind the word-for-word window, each one
    // reaching further back than the last: that is the whole trick, and a gap would mean it missed.
    const summaries = wake.items.filter((item) => item.kind === 'summary')
    expect(summaries.length).toBeLessThanOrEqual(6)
    expect(summaries.map((item) => item.range.hi - item.range.lo)).toEqual(
      [...summaries.map((item) => item.range.hi - item.range.lo)].sort((a, b) => b - a),
    )
    expect(wake.items.filter((item) => item.kind === 'gap')).toEqual([])
    expect(wake.tokens).toBeLessThanOrEqual(2_000)
    expect(covered(wake.items)).toBe(512)
  })

  it('names a range nobody has summarised rather than letting the history look shorter than it is', () => {
    const { notes } = notesFor()
    fill(notes, 4_000)

    const wake = notes.wake(2_000)

    const gaps = wake.items.filter((item) => item.kind === 'gap')
    expect(gaps.length).toBeGreaterThan(0)
    expect(renderWake(wake.items)).toContain('not summarised yet')
    expect(covered(wake.items)).toBe(4_000)
  })

  it('asks for the oldest missing rung first, because a summary is written from its two halves', () => {
    const { notes } = notesFor()
    fill(notes, 16)

    expect(notes.due()).toEqual({ lo: 0, hi: 8 })
    notes.nap({ lo: 0, hi: 8 }, 'the first eight')
    expect(notes.due()).toEqual({ lo: 8, hi: 16 })
    notes.nap({ lo: 8, hi: 16 }, 'the second eight')
    expect(notes.due()).toEqual({ lo: 0, hi: 16 })
  })

  it('has nothing due once the tree is complete', () => {
    const { notes } = notesFor()
    fill(notes, 8)

    notes.nap({ lo: 0, hi: 8 }, 'the first eight')

    expect(notes.due()).toBeNull()
  })
})

describe('Zoom', () => {
  it('reaches every note in the log from what the wake shows, one range at a time', () => {
    const { notes } = notesFor()
    fill(notes, 1_000)

    const seen = new Set<number>()
    const open = (range: NoteRange): void => {
      const zoomed = notes.zoom(range)
      for (const note of zoomed.notes) seen.add(note.id)
      for (const node of zoomed.nodes) open(node.range)
    }
    for (const item of notes.wake(2_000).items) {
      if (item.kind === 'note') seen.add(item.note.id)
      else open(item.range)
    }

    expect(seen.size).toBe(1_000)
  })

  it('opens a summarised range into its two halves, and a small one into the notes themselves', () => {
    const { notes } = notesFor()
    fill(notes, 32)

    const wide = notes.zoom({ lo: 0, hi: 32 })
    const leaf = notes.zoom({ lo: 0, hi: 8 })

    expect(wide.nodes.map((node) => rangeLabel(node.range))).toEqual(['#0–15', '#16–31'])
    expect(wide.notes).toEqual([])
    expect(leaf.notes).toHaveLength(8)
  })
})

describe('Summaries', () => {
  it('refuses a range that is not one a summary covers, and says what one looks like', () => {
    const { notes } = notesFor()
    fill(notes, 32)

    expect(() => notes.nap({ lo: 3, hi: 11 }, 'eight of them')).toThrow(/starts on its own multiple/)
    expect(() => notes.nap({ lo: 0, hi: 4 }, 'four of them')).toThrow(/power of two/)
  })

  it('refuses a range the log has not reached yet, rather than summarising notes nobody wrote', () => {
    const { notes } = notesFor()
    fill(notes, 10)

    expect(() => notes.nap({ lo: 8, hi: 16 }, 'the second eight')).toThrow(/the log holds 10 notes/)
  })

  it('forgets a summary and not one note under it', () => {
    const { notes } = notesFor()
    fill(notes, 8)
    notes.nap({ lo: 0, hi: 8 }, 'the first eight')

    expect(notes.forget({ lo: 0, hi: 8 })).toBe(true)
    expect(notes.summaries()).toBe(0)
    expect(notes.notes()).toBe(8)
    expect(notes.zoom({ lo: 0, hi: 8 }).notes).toHaveLength(8)
  })

  it('says so plainly when there was no summary to forget', () => {
    const { notes } = notesFor()
    fill(notes, 8)

    expect(notes.forget({ lo: 0, hi: 8 })).toBe(false)
  })
})

describe('Recall', () => {
  it('finds a note written a thousand notes ago, word for word', () => {
    const { notes } = notesFor()
    fill(notes, 500)
    notes.add('the e2e seed is flaky on Mondays', 'employee')
    fill(notes, 500, 500)

    const found = notes.search(/flaky on Mondays/i)

    expect(found.total).toBe(1)
    expect(found.matches[0]?.text).toBe('the e2e seed is flaky on Mondays')
    expect(found.matches[0]?.id).toBe(500)
  })

  it('answers with the newest matches first and says when there were more', () => {
    const { notes } = notesFor()
    fill(notes, 300)

    const found = notes.search(/the suite hangs/i, 10)

    expect(found.total).toBe(300)
    expect(found.matches).toHaveLength(10)
    expect(found.truncated).toBe(true)
    expect(found.matches[0]?.id).toBe(299)
  })
})

describe('The move from the old memory file', () => {
  const LEGACY = [
    '## Lessons',
    '',
    "- web-app's vitest run needs --pool=threads on this machine, otherwise the suite hangs at 90%.",
    '  _Learned on TC-118 · written by Nova · 2026-09-15_',
    '',
    '## From the boss',
    '',
    '- Ship small PRs. If a ticket grows past a day, split it and tell me.',
    '  _Added by Yuri · 2026-09-17_',
    '',
  ].join('\n')

  it('reads the old file into the log once, oldest first, and keeps the file as a .bak', () => {
    const files = inMemoryNotesFiles()
    files.write(legacyNotesPath(FOLDER, 'emp-1'), LEGACY)
    const { notes } = notesFor(files)

    const view = notes.view(4_000)

    expect(view.notes).toBe(2)
    expect(view.recent.map((note) => note.text)).toEqual([
      'From the boss: Ship small PRs. If a ticket grows past a day, split it and tell me.',
      "Lessons: web-app's vitest run needs --pool=threads on this machine, otherwise the suite hangs at 90%.",
    ])
    expect(files.read(legacyNotesPath(FOLDER, 'emp-1'))).toBeNull()
    expect(files.read(`${legacyNotesPath(FOLDER, 'emp-1')}.bak`)).toBe(LEGACY)
  })

  it('credits the boss’s own entries to the boss, and keeps the day the file gave', () => {
    const files = inMemoryNotesFiles()
    files.write(legacyNotesPath(FOLDER, 'emp-1'), LEGACY)
    const { notes } = notesFor(files)

    const [boss, lesson] = notes.view(4_000).recent

    expect(boss?.by).toBe('boss')
    expect(boss?.at.slice(0, 10)).toBe('2026-09-17')
    expect(lesson?.by).toBe('employee')
    expect(lesson?.at.slice(0, 10)).toBe('2026-09-15')
  })

  it('splits an entry longer than a note rather than dropping any of it', () => {
    const files = inMemoryNotesFiles()
    const long = `- ${'word '.repeat(200).trim()}`
    files.write(legacyNotesPath(FOLDER, 'emp-1'), long)
    const { notes } = notesFor(files)

    const view = notes.view(8_000)

    expect(view.notes).toBeGreaterThan(1)
    expect(
      view.recent
        .map((note) => note.text)
        .reverse()
        .join(' '),
    ).toBe('word '.repeat(200).trim())
  })

  it('does not run twice, and never touches a log that already has notes in it', () => {
    const files = inMemoryNotesFiles()
    files.write(legacyNotesPath(FOLDER, 'emp-1'), LEGACY)
    const first = notesFor(files)
    first.notes.notes()
    first.notes.add('written after the move', 'employee')

    const second = notesFor(files)

    expect(second.notes.notes()).toBe(3)
  })
})

/** Every rung of the ladder written, bottom up, as an Employee that never skips a `nap` would. */
function summariseAll(notes: ReturnType<typeof notesFor>['notes'], total: number): void {
  for (let size = 8; size <= total; size *= 2) {
    for (let lo = 0; lo + size <= total; lo += size) {
      notes.nap({ lo, hi: lo + size }, `notes ${lo} to ${lo + size - 1}, in one line`)
    }
  }
}

/** How many distinct notes the wake's items stand for: read outright, summarised or named as a gap. */
function covered(items: WakeItem[]): number {
  const seen = new Set<number>()
  for (const item of items) {
    if (item.kind === 'note') seen.add(item.note.id)
    else for (let at = item.range.lo; at < item.range.hi; at++) seen.add(at)
  }
  return seen.size
}
