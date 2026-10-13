import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { companyChannels } from '../../../shared/domain/channels'
import { isTemporaryFolder, TEMPORARY_ROOTS } from '../../../shared/platform/temporary-folder'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryRecents, onDisk } from '../../core/testing'
import { registerCompanyMoveIpc } from './company-move-ipc'

const engines: CompanyEngine[] = []
const dirs: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tinycorp-move-ipc-')))
  dirs.push(dir)
  return dir
}

function setup(picked: string | null) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({ recents: inMemoryRecents(), log: () => {} })
  engines.push(engine)
  const broadcasts: (Company | null)[] = []
  const asked: string[] = []
  registerCompanyMoveIpc({
    ipc,
    engine,
    tempDir: onDisk('/scratch/os-temp'),
    pickFolder: async (company) => {
      asked.push(company.name)
      return picked
    },
    broadcastChanged: (company) => broadcasts.push(company),
  })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts, asked }
}

describe('Company move IPC', () => {
  it('lists the temporary roots with the OS temp dir', async () => {
    const { invoke } = setup(null)

    const roots = (await invoke(companyChannels.temporaryRoots)) as string[]

    // The POSIX roots are the shared constants, as written; only the OS temp dir is this machine's.
    expect(roots).toEqual(expect.arrayContaining([...TEMPORARY_ROOTS, onDisk('/scratch/os-temp')]))
    expect(isTemporaryFolder(onDisk('/scratch/os-temp/acme'), roots)).toBe(true)
  })

  it('asks for a folder and moves the Company there', async () => {
    const to = join(scratch(), 'acme')
    const { engine, invoke, asked } = setup(to)
    const from = join(scratch(), 'acme')
    mkdirSync(from)
    const acme = engine.createCompany({ folder: from, name: 'Acme' })

    const result = await invoke(companyChannels.move, acme.id)

    expect(asked).toEqual(['Acme'])
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ id: acme.id, folder: to }) })
    expect(existsSync(join(to, 'company.sqlite'))).toBe(true)
  })

  it('does nothing when the picker is cancelled, and refuses an unknown Company', async () => {
    const { engine, invoke, asked } = setup(null)
    const from = join(scratch(), 'acme')
    mkdirSync(from)
    const acme = engine.createCompany({ folder: from, name: 'Acme' })

    expect(await invoke(companyChannels.move, acme.id)).toEqual({ ok: true, value: null })
    expect(await invoke(companyChannels.move, 'nope')).toEqual({ ok: false, error: 'Unknown Company: nope' })
    expect(asked).toEqual(['Acme'])
    expect(engine.currentCompany()?.folder).toBe(from)
  })
})
