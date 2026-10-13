import type { DatabaseSync } from 'node:sqlite'
import { NOTES_BUDGET_DEFAULT, NOTES_BUDGETS } from '../../../shared/memory/notes'
import type { Migration } from '../../core'

/**
 * `Read at session start`: how many tokens of its own notes an Employee reads when a Session
 * starts (T193). One number per Company, because it is the boss's trade — a bigger wake is more
 * history and less room for the ticket — and every Employee in a Company works the same way.
 */
export const NOTES_BUDGET_MIGRATION: Migration = {
  name: 'notes-wake-budget',
  sql: `
  CREATE TABLE notes_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    wake_tokens INTEGER NOT NULL
  );
`,
}

export interface NotesSettings {
  /** The Company's budget in tokens. {@link NOTES_BUDGET_DEFAULT} until the boss sets one. */
  budget(): number
  setBudget(tokens: number): number
}

export function createNotesSettings(db: DatabaseSync, onChange: () => void = () => {}): NotesSettings {
  return {
    budget() {
      const row = db.prepare('SELECT wake_tokens FROM notes_setting WHERE id = 1').get() as
        | { wake_tokens: number }
        | undefined
      // A number this build does not offer is not a reason to read nothing back.
      return isBudget(row?.wake_tokens) ? row.wake_tokens : NOTES_BUDGET_DEFAULT
    },
    setBudget(tokens) {
      if (!isBudget(tokens)) {
        throw new Error(`Read at session start is ${NOTES_BUDGETS.join(', ')} tokens, not ${String(tokens)}`)
      }
      db.prepare(
        `INSERT INTO notes_setting (id, wake_tokens) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET wake_tokens = excluded.wake_tokens`,
      ).run(tokens)
      onChange()
      return tokens
    },
  }
}

function isBudget(value: unknown): value is (typeof NOTES_BUDGETS)[number] {
  return (NOTES_BUDGETS as readonly unknown[]).includes(value)
}
