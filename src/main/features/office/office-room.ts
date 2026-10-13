import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_ROOM, isRoomSlug, isSelectable, type RoomSlug, roomOf } from '../../../shared/office/rooms'
import type { Migration } from '../../core'

/**
 * The room every Employee of a Company works in (T83). One column on `company`: the choice is a
 * Company setting, read on the next office render. Nothing about a Session depends on it.
 */
export const OFFICE_ROOM_MIGRATION: Migration = {
  name: 'company-office-room',
  sql: `
  ALTER TABLE company ADD COLUMN office_room TEXT;
`,
}

/**
 * The Company's room. Falls back to the default for a Company from before the column, for a slug a
 * later build wrote, and for a room whose geometry this build does not have.
 */
export function readOfficeRoom(db: DatabaseSync): RoomSlug {
  const row = db.prepare('SELECT office_room AS slug FROM company').get() as { slug?: string | null } | undefined
  const slug = row?.slug
  return isRoomSlug(slug) && isSelectable(roomOf(slug)) ? slug : DEFAULT_ROOM
}

/** Saves the Company's room. Throws for an unknown room, and for one whose geometry is not in yet. */
export function writeOfficeRoom(db: DatabaseSync, slug: string): RoomSlug {
  if (!isRoomSlug(slug)) throw new Error(`Unknown room: ${slug}`)
  const room = roomOf(slug)
  if (!isSelectable(room)) throw new Error(`${room.name} is coming soon: its geometry is not measured yet`)
  db.prepare('UPDATE company SET office_room = ?').run(slug)
  return slug
}
