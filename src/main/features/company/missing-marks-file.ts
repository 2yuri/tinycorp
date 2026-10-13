import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MissingMarks } from './missing-folders'

/**
 * When each Company's folder was first seen deleted, as a JSON file beside the recent Companies
 * (T57). It holds nothing while every folder is there, so the file only exists after a sighting.
 */
export function missingMarksFile(file: string): MissingMarks {
  return {
    read() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      } catch {
        return {}
      }
    },

    write(marks) {
      if (Object.keys(marks).length === 0) {
        rmSync(file, { force: true })
        return
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(marks, null, 2))
    },
  }
}
