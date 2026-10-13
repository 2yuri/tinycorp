// The design's own fixture for the drawer's Memory tab (Pen frame `x40RJd`), as the engine would
// hand it over: a wake of three recent notes over two summarised ranges, with one summary due.
import type { Note, NotesNode, NotesView } from '../../../../shared/memory/notes'

/** The Tech Lead the frame opens the drawer on. */
export const employeeName = 'Nova'
export const employeeId = 'emp-nova'

/** The day the frame was drawn, so "Today 14:02" and "Yesterday" land as it shows them. */
export const NOW = Date.parse('2026-09-21T16:00:00')

const recent: Note[] = [
  { id: 141, at: '2026-09-21T14:02:00', by: 'boss', text: 'Split TC-151 in two; boss wants PRs under a day.' },
  {
    id: 140,
    at: '2026-09-21T11:40:00',
    by: 'employee',
    text: 'billing-api migrations are named <area>-<what>, never numbered.',
  },
  {
    id: 139,
    at: '2026-09-20T17:12:00',
    by: 'employee',
    text: 'web-app vitest needs --pool=threads here, or it hangs at 90%.',
  },
]

const earlier: NotesNode[] = [
  {
    range: { lo: 96, hi: 112 },
    text: 'Moved billing to formatPrice; three review rounds with Iris on locale; learned the e2e seed is flaky on Mondays.',
    at: '2026-09-20T18:00:00',
    from: '2026-09-14T09:00:00',
    to: '2026-09-20T18:00:00',
  },
  {
    range: { lo: 64, hi: 96 },
    // The frame writes a Provider's name here; the renderer may name none (`no-provider-names.test.ts`),
    // so the fixture says the same thing in the same shape without one.
    text: "Took over TC-120 from Vega mid-ticket; set up web-app's test pool; the boss asked for smaller PRs.",
    at: '2026-09-13T18:00:00',
    from: '2026-09-06T09:00:00',
    to: '2026-09-13T17:30:00',
  },
]

/** The frame's own numbers: 142 notes, 9 summaries, 3.1k of 4k tokens, one summary due. */
export const view: NotesView = {
  recent,
  earlier,
  tokens: 3_100,
  budget: 4_000,
  notes: 142,
  summaries: 9,
  due: { lo: 112, hi: 120 },
}

/** What `Raw log` shows, so the button has something to open in the capture. */
export const raw = recent
  .map((note) => `${note.at}\t${note.by}\t${note.text}`)
  .reverse()
  .join('\n')
