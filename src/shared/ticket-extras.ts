/** How urgent a ticket is, lowest first. `normal` is the default. */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_TITLES: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

/** The colours an epic can carry, as names the renderer maps to design tokens. */
export const EPIC_COLORS = ['indigo', 'violet', 'green', 'amber', 'red', 'blue'] as const
export type EpicColor = (typeof EPIC_COLORS)[number]

/** The colour a new epic gets when none is chosen: the palette in turn. */
export function defaultEpicColor(existingEpics: number): EpicColor {
  return EPIC_COLORS[existingEpics % EPIC_COLORS.length]!
}

/** At most this many labels on a ticket, each at most this many characters. */
export const MAX_LABELS = 20
export const MAX_LABEL_LENGTH = 32

/** A stable colour for a label name, so the same label always gets the same dot. */
export function labelColor(label: string): EpicColor {
  // FNV-1a: a multiply-by-31 hash is the character sum modulo the palette size, which clusters.
  let hash = 2166136261
  for (const char of label.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return EPIC_COLORS[hash % EPIC_COLORS.length]!
}

/** Trims, drops blanks and case-insensitive duplicates, keeping the first spelling. */
export function normalizeLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, ' ')
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    result.push(label)
  }
  return result
}

/**
 * Whether `name` can be a git branch to start from and merge into (a subset of `git check-ref-format`).
 * No leading `-`, no `..`, no spaces or control characters, no `~^:?*[\`, no trailing `/` or `.lock`.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false
  if (name.endsWith('.') || name.endsWith('.lock') || name === '@') return false
  if (name.includes('..') || name.includes('//') || name.includes('@{')) return false
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false
  return name.split('/').every((part) => part.length > 0 && !part.startsWith('.'))
}
