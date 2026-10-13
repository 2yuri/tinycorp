import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Boss } from '../../shared/boss-profile'
import type { BossProfileStore } from '../features/company'

/**
 * The boss profile kept as a JSON file, normally `boss-profile.json` beside `recent-companies.json`
 * in Electron's userData folder. One per boss, whatever Companies they run (T79).
 */
export function bossProfileFile(file: string): BossProfileStore {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        // An array or a scalar is not a profile; the engine then starts a fresh one.
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<Boss>) : null
      } catch {
        return null
      }
    },
    write(profile) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(profile, null, 2))
    },
  }
}
