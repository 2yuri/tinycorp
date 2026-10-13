import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isKeepAwakeMode, type KeepAwakeMode } from '../../shared/app/keep-awake'
import type { KeepAwakeStore } from './keep-awake'

/**
 * The boss's keep-awake mode as a JSON file, normally `keep-awake.json` beside
 * `boss-profile.json` in Electron's userData folder: one Mac, one decision, whatever Companies
 * are open (T99, decision 47).
 */
export function keepAwakeFile(file: string): KeepAwakeStore {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        const mode = (parsed as { mode?: unknown })?.mode
        return isKeepAwakeMode(mode) ? mode : null
      } catch {
        return null
      }
    },
    write(mode: KeepAwakeMode) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ mode }, null, 2))
    },
  }
}
