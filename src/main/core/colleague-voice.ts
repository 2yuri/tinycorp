import type { DatabaseSync } from 'node:sqlite'
import { type ColleagueVoice, DEFAULT_COLLEAGUE_VOICE, isColleagueVoice } from '../../shared/colleague-voice'
import type { Migration } from './database'

/**
 * How Employees talk to each other, per Company (T180). One row, like the review round limit and
 * who tests: it is one Company-wide choice, not a per-Employee one, because two Employees in the
 * same DM have to agree on the voice they are both writing in.
 *
 * A Company made before this reads {@link DEFAULT_COLLEAGUE_VOICE}, which is `terse`: the default
 * is the cheaper one, and the boss's own side of every conversation is unaffected either way.
 */
export const COLLEAGUE_VOICE_MIGRATION: Migration = {
  name: 'company-colleague-voice',
  sql: `
  CREATE TABLE voice_setting (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    colleague_voice TEXT NOT NULL
  );
`,
}

/** What a Company reads and writes about the voice its Employees use on each other. */
export interface VoiceSettings {
  colleagueVoice(): ColleagueVoice
  setColleagueVoice(voice: ColleagueVoice): ColleagueVoice
}

export function createVoiceSettings(db: DatabaseSync, onChange: () => void = () => {}): VoiceSettings {
  return {
    colleagueVoice() {
      const row = db.prepare('SELECT colleague_voice FROM voice_setting WHERE id = 1').get() as
        | { colleague_voice: string }
        | undefined
      // A value this build does not know is not a reason to write nothing: fall back to the default.
      return isColleagueVoice(row?.colleague_voice) ? row.colleague_voice : DEFAULT_COLLEAGUE_VOICE
    },

    setColleagueVoice(voice) {
      if (!isColleagueVoice(voice)) throw new Error(`Unknown colleague voice: ${String(voice)}`)
      db.prepare(
        `INSERT INTO voice_setting (id, colleague_voice) VALUES (1, ?)
         ON CONFLICT (id) DO UPDATE SET colleague_voice = excluded.colleague_voice`,
      ).run(voice)
      onChange()
      return voice
    },
  }
}
