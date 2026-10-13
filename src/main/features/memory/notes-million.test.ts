import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { removeFolder } from '../../core/testing'
import { employeeNotes } from './notes'
import { notesFilesOnDisk, notesLogPath } from './notes-files'

/**
 * A million notes, on a real disk (T193).
 *
 * The rest of the suite runs against a map in memory, which proves the arithmetic and nothing
 * about the file. This one is the claim the whole feature rests on: *the wake is the same size at
 * fifty notes or a million*, and a wake that had to walk a hundred megabytes to say so would be a
 * Session that takes a minute to start.
 *
 * It is time-boxed on purpose. The numbers below are generous by an order of magnitude on any
 * machine CI runs on, so a failure here is a scan that came back, not a slow runner.
 */

const NOTES = 1_000_000
const EMPLOYEE = 'emp-1'

/** Long enough for the file to be real — about 85 MB — and inside the 280-byte limit. */
const TEXT = 'the suite hangs at 90% on this machine; --pool=threads fixes it'

const folder = mkdtempSync(join(tmpdir(), 'tinycorp-notes-'))
afterAll(() => removeFolder(folder))

/** The log written straight to disk, because a million `append` calls is the test's own runtime. */
function generate(): void {
  const at = new Date('2026-01-01T09:00:00.000Z')
  const lines: string[] = []
  const chunks: string[] = []
  for (let id = 0; id < NOTES; id++) {
    lines.push(`${new Date(at.getTime() + id * 60_000).toISOString()}\temployee\t${id} ${TEXT}`)
    if (lines.length === 50_000) {
      chunks.push(`${lines.join('\n')}\n`)
      lines.length = 0
    }
  }
  if (lines.length > 0) chunks.push(`${lines.join('\n')}\n`)
  mkdirSync(dirname(notesLogPath(folder, EMPLOYEE)), { recursive: true })
  writeFileSync(notesLogPath(folder, EMPLOYEE), chunks.join(''))
}

describe('A million notes', () => {
  const notes = employeeNotes({
    files: notesFilesOnDisk,
    companyFolder: folder,
    employeeId: EMPLOYEE,
    now: () => new Date('2026-09-21T10:00:00.000Z'),
  })

  it('is a log this reads the length of in one pass', () => {
    generate()

    const started = Date.now()
    expect(notes.notes()).toBe(NOTES)
    expect(Date.now() - started).toBeLessThan(20_000)
  })

  it('wakes inside the budget, and fast, with nothing summarised at all', () => {
    const started = Date.now()
    const wake = notes.wake(4_000)

    expect(wake.total).toBe(NOTES)
    expect(wake.tokens).toBeLessThanOrEqual(4_000)
    // The first pass has been paid; every wake after it seeks rather than walks.
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('covers every one of them, so the oldest note is still reachable by zooming', () => {
    const wake = notes.wake(4_000)

    const seen = new Set<number>()
    for (const item of wake.items) {
      if (item.kind === 'note') seen.add(item.note.id)
      else for (let at = item.range.lo; at < item.range.hi; at++) seen.add(at)
    }

    expect(seen.size).toBe(NOTES)
  })

  it('reads the newest notes word for word rather than the oldest', () => {
    const recent = notes.view(4_000).recent

    expect(recent[0]?.id).toBe(NOTES - 1)
    expect(recent[0]?.text).toContain(`${NOTES - 1} `)
  })

  it('opens the oldest range down to the notes themselves', () => {
    let range = { lo: 0, hi: 524_288 }
    for (;;) {
      const zoomed = notes.zoom(range)
      if (zoomed.notes.length > 0) {
        expect(zoomed.notes[0]?.id).toBe(0)
        expect(zoomed.notes[0]?.text).toContain('0 the suite hangs')
        return
      }
      range = zoomed.nodes[0]!.range
    }
  })

  it('finds one note in a million, word for word', () => {
    const started = Date.now()
    const found = notes.search(/\b999123 the suite/)

    expect(found.matches.map((note) => note.id)).toEqual([999_123])
    expect(found.partial).toBe(false)
    expect(Date.now() - started).toBeLessThan(20_000)
  })

  it('appends to a log that size without reading it again', () => {
    const started = Date.now()
    const note = notes.add('one more, after a million', 'employee')

    expect(note.id).toBe(NOTES)
    expect(notes.notes()).toBe(NOTES + 1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
