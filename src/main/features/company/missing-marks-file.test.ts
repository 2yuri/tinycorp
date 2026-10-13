import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { missingMarksFile } from './missing-marks-file'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-missing-marks-'))
  dirs.push(dir)
  return join(dir, 'nested', 'missing-companies.json')
}

const marks = { a: '2026-09-17T10:00:00.000Z' }

describe('missing marks file', () => {
  it('keeps the first sighting of a deleted folder across instances', () => {
    const file = tempFile()
    missingMarksFile(file).write(marks)

    expect(missingMarksFile(file).read()).toEqual(marks)
  })

  it('removes the file once nothing is missing any more', () => {
    const file = tempFile()
    missingMarksFile(file).write(marks)
    missingMarksFile(file).write({})

    expect(existsSync(file)).toBe(false)
    expect(missingMarksFile(file).read()).toEqual({})
  })

  it('treats a missing, corrupt or wrongly shaped file as no marks at all', () => {
    const file = tempFile()
    expect(missingMarksFile(file).read()).toEqual({})

    missingMarksFile(file).write(marks)
    writeFileSync(file, '{not json')
    expect(missingMarksFile(file).read()).toEqual({})

    writeFileSync(file, JSON.stringify({ a: 1, b: '2026-09-17T10:00:00.000Z' }))
    expect(missingMarksFile(file).read()).toEqual({ b: '2026-09-17T10:00:00.000Z' })
  })
})
