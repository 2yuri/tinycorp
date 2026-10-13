import type { CompanySummary } from '../../../shared/company'
import { tildePath } from '../paths'

/** The four avatar colourings of the Launcher rows (design/html/launcher.html), as token pairs. */
export const COMPANY_TONES = ['info', 'warning', 'success', 'error'] as const
export type CompanyTone = (typeof COMPANY_TONES)[number]

/**
 * A Company's avatar colouring, fixed by its key so it stays the same wherever the key goes.
 * A Company recorded before keys existed has none until it is opened: it gets the first tone.
 */
export function companyTone(key: string | null | undefined): CompanyTone {
  let hash = 0
  for (const char of key ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COMPANY_TONES[hash % COMPANY_TONES.length]!
}

/** How many rows ⌘1…⌘N reach. */
export const SHORTCUT_ROWS = 4

/**
 * How many rows the list shows before it scrolls, which is also where the search appears (T267):
 * the frame's `Companies` box is four rows tall, and a fifth would reach the footer.
 */
export const VISIBLE_ROWS = 4

/**
 * The Companies whose name, key or folder holds the query, in the order they came. The folder is
 * matched as the row writes it — `~/code/acme` — so a boss typing their own user name does not
 * match every Company under their home.
 */
export function filterSummaries(summaries: readonly CompanySummary[], query: string): CompanySummary[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...summaries]
  return summaries.filter((summary) =>
    [summary.name, summary.key, tildePath(summary.folder)].some((field) => field.toLowerCase().includes(needle)),
  )
}

/** What the list says when the search matches no Company. */
export function noMatch(query: string): string {
  return `No company matches “${query.trim()}”.`
}

/** A key that types a character: it starts the search from anywhere in the window (not Space, which presses a row). */
export function startsSearch(key: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return key.key.length === 1 && key.key !== ' ' && !key.metaKey && !key.ctrlKey && !key.altKey
}

export type LauncherKeyAction = { kind: 'highlight'; index: number } | { kind: 'open'; index: number } | null

/** What a key press does to the Company list: arrows move the highlight, ↵ opens it, ⌘1–⌘4 open a row. */
export function launcherKey(
  key: { key: string; metaKey: boolean; ctrlKey: boolean },
  highlight: number,
  rows: number,
): LauncherKeyAction {
  if (rows === 0) return null
  if (key.metaKey || key.ctrlKey) {
    const digit = /^[1-9]$/.test(key.key) ? Number(key.key) : 0
    return digit >= 1 && digit <= Math.min(SHORTCUT_ROWS, rows) ? { kind: 'open', index: digit - 1 } : null
  }
  const current = Math.min(Math.max(highlight, 0), rows - 1)
  switch (key.key) {
    case 'ArrowDown':
      return { kind: 'highlight', index: Math.min(current + 1, rows - 1) }
    case 'ArrowUp':
      return { kind: 'highlight', index: Math.max(current - 1, 0) }
    case 'Home':
      return { kind: 'highlight', index: 0 }
    case 'End':
      return { kind: 'highlight', index: rows - 1 }
    case 'Enter':
      return { kind: 'open', index: current }
    default:
      return null
  }
}

/** The footer's version line: `v0.9.4 · beta` while the app is below 1.0. */
export function versionLabel(version: string): string {
  return version.startsWith('0.') ? `v${version} · beta` : `v${version}`
}
