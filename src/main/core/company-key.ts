import type { DatabaseSync } from 'node:sqlite'
import { companyKeyFrom } from '../../shared/company'
import { ticketCode } from '../../shared/ticket-id'

/**
 * The key of the Company `db` belongs to. It is read from the row rather than carried in, so the
 * boss renaming the key in Company settings shows up in the next line the engine writes, and no
 * module has to be handed a Company to say `TC-142` (decision 33).
 */
export function companyKeyOf(db: DatabaseSync): string {
  // `SELECT *`: a database with an odd history may predate the key column and must still read.
  const row = db.isOpen
    ? (db.prepare('SELECT * FROM company').get() as { name: string; key?: string | null } | undefined)
    : undefined
  if (!row) return ''
  return row.key ?? companyKeyFrom(row.name)
}

/** `TC-142`: how a ticket of the Company in `db` is named everywhere the engine writes one. */
export function ticketCodeIn(db: DatabaseSync, ticketId: number): string {
  return ticketCode(companyKeyOf(db), ticketId)
}
