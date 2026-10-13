import {
  EPIC_COLORS,
  type EpicColor,
  isValidBranchName,
  MAX_LABEL_LENGTH,
  MAX_LABELS,
  normalizeLabels,
  PRIORITIES,
  type Priority,
} from '../../../shared/ticket-extras'
import type { Migration } from '../../core'

/**
 * Ticket priority, labels and base branch, and the epic colour. Existing epics get the palette
 * in turn by id, matching what `defaultEpicColor` gives new ones.
 */
export const TICKET_EXTRAS_MIGRATION: Migration = {
  name: 'board-ticket-priority-labels-base-branch-epic-color',
  sql: `
  ALTER TABLE ticket ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
  ALTER TABLE ticket ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE ticket ADD COLUMN base_branch TEXT;
  ALTER TABLE epic ADD COLUMN color TEXT NOT NULL DEFAULT '${EPIC_COLORS[0]}';
  UPDATE epic SET color = CASE (id - 1) % ${EPIC_COLORS.length}
    ${EPIC_COLORS.map((color, i) => `WHEN ${i} THEN '${color}'`).join(' ')}
  END;
`,
}

export function requirePriority(value: unknown): Priority {
  if (!PRIORITIES.includes(value as Priority)) {
    throw new Error(`A priority is one of ${PRIORITIES.join(', ')}`)
  }
  return value as Priority
}

export function requireLabels(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((l) => typeof l === 'string')) {
    throw new Error('Labels must be a list of text')
  }
  const labels = normalizeLabels(value as string[])
  const long = labels.find((l) => l.length > MAX_LABEL_LENGTH)
  if (long !== undefined) throw new Error(`Label "${long}" is long; a label has at most ${MAX_LABEL_LENGTH} characters`)
  if (labels.length > MAX_LABELS) throw new Error(`A ticket has at most ${MAX_LABELS} labels`)
  return labels
}

/** Null and blank mean each repo's default branch. */
export function optionalBaseBranch(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('The base branch must be text')
  const branch = value.trim()
  if (!branch) return null
  if (!isValidBranchName(branch)) throw new Error(`"${branch}" is not a valid branch name`)
  return branch
}

export function requireEpicColor(value: unknown): EpicColor {
  if (!EPIC_COLORS.includes(value as EpicColor)) {
    throw new Error(`An epic colour is one of ${EPIC_COLORS.join(', ')}`)
  }
  return value as EpicColor
}
