import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { inMemoryRecents, onDisk } from '../../core/testing'
import { folderState, inMemoryMissingMarks, MISSING_GRACE_MS, pruneMissingCompanies } from './missing-folders'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-missing-'))
  dirs.push(dir)
  return dir
}

function company(patch: Partial<Company> & Pick<Company, 'id' | 'folder'>): Company {
  return {
    name: 'Acme',
    key: 'AC',
    boss: { name: 'Ada', initials: 'AD' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

const DAY = 24 * 60 * 60 * 1000
const start = new Date('2026-09-17T10:00:00Z')
const at = (ms: number) => () => new Date(start.getTime() + ms)

describe('a Company folder on disk', () => {
  it('is present when it is there, and deleted when only the folder around it is', () => {
    const dir = tempDir()
    const inside = join(dir, 'acme')
    mkdirSync(inside)

    expect(folderState(inside)).toBe('present')
    rmSync(inside, { recursive: true })
    expect(folderState(inside)).toBe('deleted')
  })

  it('is unreachable when its parent is gone too, the way an unmounted drive looks', () => {
    expect(folderState(onDisk('/Volumes/Backup/companies/acme'), () => false)).toBe('unreachable')
    expect(
      folderState(
        onDisk('/Volumes/Backup/companies/acme'),
        (path) => path !== onDisk('/Volumes/Backup/companies/acme'),
      ),
    ).toBe('deleted')
  })
})

describe('pruning recents of missing folders', () => {
  it('keeps a Company whose folder is there', () => {
    const recents = inMemoryRecents()
    recents.remember(company({ id: 'here', folder: tempDir() }))
    const marks = inMemoryMissingMarks()

    expect(pruneMissingCompanies({ recents, marks, now: at(0) })).toEqual([])
    expect(recents.list().map((c) => c.id)).toEqual(['here'])
    expect(marks.read()).toEqual({})
  })

  it('marks a deleted folder on the first start and forgets it once the grace has passed', () => {
    const recents = inMemoryRecents()
    const folder = join(tempDir(), 'gone')
    recents.remember(company({ id: 'gone', folder }))
    const marks = inMemoryMissingMarks()

    expect(pruneMissingCompanies({ recents, marks, now: at(0) })).toEqual([])
    expect(recents.list().map((c) => c.id)).toEqual(['gone'])
    expect(marks.read()).toEqual({ gone: start.toISOString() })

    expect(pruneMissingCompanies({ recents, marks, now: at(MISSING_GRACE_MS - DAY) })).toEqual([])
    expect(recents.list()).toHaveLength(1)

    expect(pruneMissingCompanies({ recents, marks, now: at(MISSING_GRACE_MS) })).toEqual(['gone'])
    expect(recents.list()).toEqual([])
    expect(marks.read()).toEqual({})
  })

  it('never forgets a Company on an unmounted drive, however long it stays away', () => {
    const recents = inMemoryRecents()
    recents.remember(company({ id: 'drive', folder: onDisk('/Volumes/Backup/acme') }))
    const marks = inMemoryMissingMarks()
    const unmounted = () => false

    expect(pruneMissingCompanies({ recents, marks, exists: unmounted, now: at(0) })).toEqual([])
    expect(pruneMissingCompanies({ recents, marks, exists: unmounted, now: at(400 * DAY) })).toEqual([])
    expect(recents.list().map((c) => c.id)).toEqual(['drive'])
    expect(marks.read()).toEqual({})
  })

  it('starts the grace again when the folder comes back', () => {
    const recents = inMemoryRecents()
    const folder = join(tempDir(), 'gone')
    recents.remember(company({ id: 'gone', folder }))
    const marks = inMemoryMissingMarks()

    pruneMissingCompanies({ recents, marks, now: at(0) })
    mkdirSync(folder)
    pruneMissingCompanies({ recents, marks, now: at(DAY) })
    expect(marks.read()).toEqual({})

    rmSync(folder, { recursive: true })
    pruneMissingCompanies({ recents, marks, now: at(2 * DAY) })
    expect(marks.read()).toEqual({ gone: at(2 * DAY)().toISOString() })
    expect(pruneMissingCompanies({ recents, marks, now: at(2 * DAY + MISSING_GRACE_MS - 1) })).toEqual([])
  })

  it('leaves the Companies it can still see alone while it forgets one', () => {
    const recents = inMemoryRecents()
    const dir = tempDir()
    recents.remember(company({ id: 'here', folder: dir }))
    recents.remember(company({ id: 'gone', folder: join(dir, 'gone') }))
    const marks = inMemoryMissingMarks({ gone: new Date(start.getTime() - MISSING_GRACE_MS).toISOString() })

    expect(pruneMissingCompanies({ recents, marks, now: at(0) })).toEqual(['gone'])
    expect(recents.list().map((c) => c.id)).toEqual(['here'])
  })
})
