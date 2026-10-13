import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { OutageRecord, OutageStore } from './usage-limits'

/**
 * The Providers that are out, kept as a JSON file in Electron's userData folder (T173).
 *
 * This is what makes the resume survive a restart: the limit was hit at 18:47 and resets at 21:00,
 * and an app that was closed in between still puts the team back at 21:00. It holds provider ids,
 * times and Employee ids — nothing about a credential, and no message body.
 */
export function outagesFile(file: string): OutageStore {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        return Array.isArray(parsed) ? parsed.filter(isRecord) : null
      } catch {
        // No file, or one nobody can parse: nothing is out, which is the safe thing to believe.
        return null
      }
    },
    write(records) {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(records, null, 2))
    },
  }
}

function isRecord(value: unknown): value is OutageRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<OutageRecord>
  return (
    typeof row.provider === 'string' &&
    typeof row.exhaustedAt === 'string' &&
    (row.resetsAt === null || typeof row.resetsAt === 'string') &&
    (row.accountId === null || typeof row.accountId === 'string') &&
    typeof row.checks === 'number' &&
    Array.isArray(row.waiting) &&
    Array.isArray(row.routed)
  )
}
