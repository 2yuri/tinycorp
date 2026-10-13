import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NotesModel } from './NotesPanel'
import { dueLine, footerLine, meterLine, meterShare, noteWhen, rangeDays } from './notes-model'

vi.hoisted(() => {
  const never = () => new Promise<never>(() => {})
  Object.assign(globalThis, {
    window: { tinyCorp: { notes: {}, companyMemory: { counts: never, onChanged: () => () => {} } } },
  })
})
const { NotesPanel } = await import('./NotesPanel')

/**
 * The drawer's Memory tab against its frame (`design/screens/x40RJd.png`).
 *
 * Every line the frame writes is here as a string, because those sentences are the feature: the
 * meter says the reading does not grow, and the footer says nothing was deleted. A panel that
 * quietly stopped saying either would still render.
 */

const NOW = Date.parse('2026-09-21T16:00:00')

function model(overrides: Partial<NotesModel> = {}): NotesModel {
  return {
    recent: [
      { id: 141, at: '2026-09-21T14:02:00', by: 'boss', text: 'Split TC-151 in two; boss wants PRs under a day.' },
      {
        id: 140,
        at: '2026-09-21T11:40:00',
        by: 'employee',
        text: 'billing-api migrations are named <area>-<what>, never numbered.',
      },
    ],
    earlier: [
      {
        range: { lo: 96, hi: 112 },
        text: 'Moved billing to formatPrice; three review rounds with Iris on locale.',
        at: '2026-09-20T18:00:00',
        from: '2026-09-14T09:00:00',
        to: '2026-09-20T18:00:00',
      },
    ],
    tokens: 3_100,
    budget: 4_000,
    notes: 142,
    summaries: 9,
    due: { lo: 112, hi: 120 },
    employeeName: 'Nova',
    employeeId: 'emp-nova',
    error: null,
    loaded: true,
    addNote: () => {},
    ...overrides,
  }
}

function draw(overrides: Partial<NotesModel> = {}): string {
  return renderToStaticMarkup(<NotesPanel notes={model(overrides)} now={NOW} />)
}

describe('The Memory tab', () => {
  it('says what the next Session will read, and that the number does not grow', () => {
    const html = draw()

    expect(html).toContain('Read at session start')
    expect(html).toContain('≈ 3.1k of 4k tokens')
    expect(html).toContain('The same size at 50 notes or 50,000')
  })

  it('draws the newest notes word for word, under their own heading', () => {
    const html = draw()

    expect(html).toContain('Recent · word for word')
    expect(html).toContain('Split TC-151 in two; boss wants PRs under a day.')
    expect(html).toContain('Today 14:02')
  })

  it('badges a note the boss added', () => {
    const html = draw()

    expect(html).toContain('From you')
    // Only the boss's: the other note in the fixture is the Employee's own.
    expect(html.match(/From you/g)).toHaveLength(1)
  })

  it('draws the ranges behind them as summaries, each one openable', () => {
    const html = draw()

    expect(html).toContain('Earlier · summarised')
    expect(html).toContain('#96–111')
    expect(html).toContain('Sep 14–20')
    expect(html).toContain('aria-label="Open #96–111"')
  })

  it('says one summary is due, and who writes it', () => {
    expect(draw()).toContain('1 summary due · Nova writes it at its next turn boundary')
    expect(draw({ due: null })).not.toContain('summary due')
  })

  it('counts the log in the footer, and says nothing was deleted', () => {
    expect(draw()).toContain('142 notes · 9 summaries · nothing ever deleted')
  })

  it('offers no edit and no delete, because the log only grows', () => {
    const html = draw()

    expect(html).not.toMatch(/Delete|Edit/)
    expect(html).toContain('Add note')
  })

  it('says so plainly for an Employee that has written nothing', () => {
    const html = draw({ recent: [], earlier: [], notes: 0, summaries: 0, due: null, tokens: 0 })

    expect(html).toContain('No notes yet')
    expect(html).toContain('0 notes · 0 summaries · nothing ever deleted')
  })
})

describe('The words on it', () => {
  it('writes when a note was written the way the frame does', () => {
    expect(noteWhen('2026-09-21T14:02:00', NOW)).toBe('Today 14:02')
    expect(noteWhen('2026-09-20T17:12:00', NOW)).toBe('Yesterday')
    expect(noteWhen('2026-09-14T09:00:00', NOW)).toBe('Sep 14')
    expect(noteWhen('', NOW)).toBe('')
  })

  it('writes a range’s days as one month where it can', () => {
    expect(rangeDays('2026-09-14T09:00:00', '2026-09-20T18:00:00')).toBe('Sep 14–20')
    expect(rangeDays('2026-08-30T09:00:00', '2026-09-02T18:00:00')).toBe('Aug 30–Sep 2')
    expect(rangeDays('2026-09-14T09:00:00', '2026-09-14T18:00:00')).toBe('Sep 14')
    expect(rangeDays(null, null)).toBe('')
  })

  it('rounds the meter the way the frame does, and never draws past its end', () => {
    expect(meterLine(3_100, 4_000)).toBe('≈ 3.1k of 4k tokens')
    expect(meterLine(840, 2_000)).toBe('≈ 840 of 2k tokens')
    expect(meterShare(3_100, 4_000)).toBeCloseTo(0.775)
    expect(meterShare(5_000, 4_000)).toBe(1)
    expect(meterShare(100, 0)).toBe(0)
  })

  it('counts in the footer’s own words, singular included', () => {
    expect(footerLine(142, 9)).toBe('142 notes · 9 summaries · nothing ever deleted')
    expect(footerLine(1, 1)).toBe('1 note · 1 summary · nothing ever deleted')
    expect(footerLine(50_000, 0)).toBe('50,000 notes · 0 summaries · nothing ever deleted')
  })

  it('names who owes the summary, or says nothing at all', () => {
    expect(dueLine({ lo: 112, hi: 120 }, 'Nova')).toBe('1 summary due · Nova writes it at its next turn boundary')
    expect(dueLine(null, 'Nova')).toBeNull()
  })
})
