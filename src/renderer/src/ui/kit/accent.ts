/**
 * One colour per Employee. The accent is derived from the Employee id, never from a name or a seat,
 * so an Employee reads the same in chat, the Inbox, the sidebar, the board and the drawer — and keeps
 * that colour when they are renamed. The pairs are the design's: a deep tile and a light tag.
 */
export const ACCENTS = ['indigo', 'green', 'amber', 'pink', 'cyan', 'purple', 'blue', 'red', 'teal'] as const

export type Accent = (typeof ACCENTS)[number]

/** The accent of an Employee id. Stable for the life of the Employee, and the same in every window. */
export function accentFor(id: string): Accent {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return ACCENTS[hash % ACCENTS.length]!
}
