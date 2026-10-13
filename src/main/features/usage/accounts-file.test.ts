import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFolder } from '../../core/testing'
import { accountsFile } from './accounts-file'
import { outagesFile } from './outages-file'
import type { OutageRecord } from './usage-limits'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) removeFolder(folder)
})

function tempFile(name: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-store-'))
  folders.push(folder)
  return join(folder, name)
}

describe('The accounts file', () => {
  it('keeps a label and a directory, and nothing that could be a credential', () => {
    const file = tempFile('provider-accounts.json')
    const store = accountsFile(file)

    store.write([{ id: 'acc-1', provider: 'claude', label: 'Work', configDir: '/tmp/work', isDefault: false }])

    expect(store.read()).toEqual([
      { id: 'acc-1', provider: 'claude', label: 'Work', configDir: '/tmp/work', isDefault: false },
    ])
    const written: unknown = JSON.parse(readFileSync(file, 'utf8'))
    expect(Object.keys((written as Record<string, unknown>[])[0]!)).toEqual([
      'id',
      'provider',
      'label',
      'configDir',
      'isDefault',
    ])
  })

  it('reads no accounts rather than throwing when there is no file, or a broken one', () => {
    expect(accountsFile(tempFile('missing.json')).read()).toBeNull()
    const broken = tempFile('broken.json')
    writeFileSync(broken, '{ not json')
    expect(accountsFile(broken).read()).toBeNull()
  })

  it('drops a row that is not an account, so one bad line does not lose the rest', () => {
    const file = tempFile('mixed.json')
    writeFileSync(
      file,
      JSON.stringify([
        { id: 'acc-1', provider: 'claude', label: 'Work', configDir: '/tmp/work', isDefault: false },
        { id: 'acc-2' },
      ]),
    )

    expect(accountsFile(file).read()).toHaveLength(1)
  })
})

describe('The outages file', () => {
  const record: OutageRecord = {
    provider: 'claude',
    accountId: null,
    exhaustedAt: '2026-09-17T18:47:00.000Z',
    resetsAt: '2026-09-17T21:00:00.000Z',
    checks: 0,
    waiting: [{ companyId: 'c-1', employeeId: 'e-iris' }],
    routed: [{ companyId: 'c-1', employeeId: 'e-vega', to: 'codex', model: null }],
  }

  it('remembers a limit across a restart, with who was stopped and who was moved', () => {
    const file = tempFile('provider-outages.json')

    outagesFile(file).write([record])

    expect(outagesFile(file).read()).toEqual([record])
  })

  it('believes nothing is out when the file is missing or unreadable', () => {
    expect(outagesFile(tempFile('gone.json')).read()).toBeNull()
    const broken = tempFile('broken.json')
    writeFileSync(broken, 'null')
    expect(outagesFile(broken).read()).toBeNull()
  })
})
