import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { onDisk } from '../core/testing'
import { recentsFile } from './recents-file'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tinycorp-recents-'))
  dirs.push(dir)
  return join(dir, 'nested', 'recent-companies.json')
}

const acme = {
  id: 'a',
  name: 'Acme',
  key: 'AC',
  boss: { name: 'Ada', initials: 'AD' },
  folder: onDisk('/work/acme'),
  createdAt: '2026-09-17T00:00:00.000Z',
}

describe('recents file', () => {
  it('remembers Companies across instances', () => {
    const file = tempFile()
    recentsFile(file).remember(acme)
    recentsFile(file).remember({ ...acme, name: 'Acme Inc' })

    expect(recentsFile(file).list()).toEqual([{ ...acme, name: 'Acme Inc' }])
  })

  it('keeps the order Companies were first opened in', () => {
    const file = tempFile()
    const globex = { ...acme, id: 'g', name: 'Globex', folder: onDisk('/work/globex') }
    recentsFile(file).remember(acme)
    recentsFile(file).remember(globex)
    recentsFile(file).remember(acme)

    expect(
      recentsFile(file)
        .list()
        .map((c) => c.name),
    ).toEqual(['Acme', 'Globex'])
  })

  it('forgets a Company across instances and ignores an unknown id', () => {
    const file = tempFile()
    const globex = { ...acme, id: 'g', name: 'Globex', folder: onDisk('/work/globex') }
    recentsFile(file).remember(acme)
    recentsFile(file).remember(globex)
    recentsFile(file).forget('a')
    recentsFile(file).forget('nope')

    expect(recentsFile(file).list()).toEqual([globex])
  })

  it('treats a missing or corrupt file as empty', () => {
    const file = tempFile()
    expect(recentsFile(file).list()).toEqual([])

    recentsFile(file).remember(acme)
    writeFileSync(file, '{not json')
    expect(recentsFile(file).list()).toEqual([])
  })
})
