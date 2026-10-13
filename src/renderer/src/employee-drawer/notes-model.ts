import type { NoteRange } from '../../../shared/memory/notes'

/**
 * The words the drawer's Memory tab puts on an Employee's note log (frame `x40RJd`).
 *
 * All of it is pure, because every one of these lines is a sentence somebody reads and a sentence
 * is worth a test. What the panel draws is in `NotesPanel.tsx`.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `Today 14:02`, `Yesterday`, `Sep 14` — when a note was written, as the row's left column. */
export function noteWhen(at: string, now: number): string {
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return ''
  const days = Math.round((startOfDay(now) - startOfDay(when.getTime())) / 86_400_000)
  if (days <= 0) return `Today ${clock(when)}`
  if (days === 1) return 'Yesterday'
  return day(when)
}

/** `Sep 14–20`, or `Sep 14` for a range that starts and ends on the same day. */
export function rangeDays(from: string | null, to: string | null): string {
  const first = from ? new Date(from) : null
  const last = to ? new Date(to) : null
  if (!first || Number.isNaN(first.getTime())) return ''
  if (!last || Number.isNaN(last.getTime()) || sameDay(first, last)) return day(first)
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${day(first)}–${last.getDate()}`
  }
  return `${day(first)}–${day(last)}`
}

/** `≈ 3.1k of 4k tokens`, as the meter writes what the next Session will read. */
export function meterLine(tokens: number, budget: number): string {
  return `≈ ${thousands(tokens)} of ${thousands(budget)} tokens`
}

/** How full the meter's bar is, never past its end even when a wake came in over. */
export function meterShare(tokens: number, budget: number): number {
  if (budget <= 0) return 0
  return Math.min(1, tokens / budget)
}

/** `142 notes · 9 summaries · nothing ever deleted` — the footer, which is also the promise. */
export function footerLine(notes: number, summaries: number): string {
  return `${count(notes, 'note')} · ${count(summaries, 'summary', 'summaries')} · nothing ever deleted`
}

/** `1 summary due · Nova writes it at its next turn boundary`, or null when the tree is complete. */
export function dueLine(due: NoteRange | null, employeeName: string): string | null {
  if (!due) return null
  return `1 summary due · ${employeeName} writes it at its next turn boundary`
}

function count(value: number, one: string, many = `${one}s`): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`
}

/** `3.1k`, `4k`, `840` — the frame's own rounding, which never shows a trailing `.0`. */
function thousands(value: number): string {
  if (value < 1000) return `${value}`
  const k = (value / 1000).toFixed(1)
  return `${k.endsWith('.0') ? k.slice(0, -2) : k}k`
}

function clock(at: Date): string {
  return `${`${at.getHours()}`.padStart(2, '0')}:${`${at.getMinutes()}`.padStart(2, '0')}`
}

function day(at: Date): string {
  return `${MONTHS[at.getMonth()]} ${at.getDate()}`
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a.getTime()) === startOfDay(b.getTime())
}

/** Midnight before `at` in the boss's own timezone, so "Yesterday" counts days and not 24 hours. */
function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
