import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Company } from '../../../shared/company'
import { companyChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { createCompanyLogos } from './company-logo'
import { registerCompanyIpc, syncedRoots } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup({
  pickedFolder = null as string | null,
  homeFolder = onDisk('/home/boss'),
  env = {} as NodeJS.ProcessEnv,
  pickedImage = null as string | null,
} = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const broadcasts: (Company | null)[] = []
  let attentionBroadcasts = 0
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
  })
  engines.push(engine)
  registerCompanyIpc({
    ipc,
    engine,
    pickFolder: async () => pickedFolder,
    homeFolder: () => homeFolder,
    env,
    broadcastChanged: (company) => broadcasts.push(company),
    broadcastAttention: () => attentionBroadcasts++,
    logos: createCompanyLogos({ toPng: (path) => Buffer.from(`png of ${path}`) }),
    pickImage: async () => pickedImage,
  })
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler(...args)
  }
  return { invoke, broadcasts, engine, attentionBroadcasts: () => attentionBroadcasts }
}

describe('Company IPC', () => {
  it('answers the rail with each open Company and tells every window when a count moves (T145)', async () => {
    const { invoke, engine, attentionBroadcasts } = setup()
    const created = (await invoke(companyChannels.create, { folder: onDisk('/work/acme'), name: 'Acme' })) as {
      value: Company
    }

    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const before = attentionBroadcasts()
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss can you confirm?' })

    expect(attentionBroadcasts()).toBeGreaterThan(before)
    expect(await invoke(companyChannels.attention)).toEqual([
      { companyId: created.value.id, waiting: 1, working: false },
    ])
  })

  it('creates a Company and reports it as current and listed', async () => {
    const { invoke } = setup()

    const created = await invoke(companyChannels.create, { folder: onDisk('/work/acme'), name: 'Acme' })

    expect(created).toMatchObject({ ok: true, value: { name: 'Acme', folder: onDisk('/work/acme') } })
    expect(await invoke(companyChannels.current)).toMatchObject({ name: 'Acme' })
    expect(await invoke(companyChannels.list)).toEqual([expect.objectContaining({ name: 'Acme' })])
  })

  it('returns engine refusals as errors instead of throwing', async () => {
    const { invoke } = setup()

    const result = await invoke(companyChannels.open, onDisk('/work/empty'))

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/no company/i) })
  })

  it('rejects malformed input from the renderer', async () => {
    const { invoke } = setup()

    expect(await invoke(companyChannels.create, { folder: 42 })).toMatchObject({ ok: false })
    expect(await invoke(companyChannels.open, undefined)).toMatchObject({ ok: false })
    expect(await invoke(companyChannels.switchTo, null)).toMatchObject({ ok: false })
    expect(await invoke(companyChannels.list)).toEqual([])
  })

  it('switches Companies and broadcasts every change', async () => {
    const { invoke, broadcasts } = setup()
    const acme = await invoke(companyChannels.create, { folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(companyChannels.create, { folder: onDisk('/work/globex'), name: 'Globex' })
    if (!(acme as { ok: boolean }).ok) throw new Error('create failed')
    const acmeId = (acme as { value: Company }).value.id

    const switched = await invoke(companyChannels.switchTo, acmeId)

    expect(switched).toMatchObject({ ok: true, value: { name: 'Acme' } })
    expect(broadcasts.map((c) => c?.name)).toEqual(['Acme', 'Globex', 'Acme'])
  })

  it('saves Company settings and broadcasts the renamed Company', async () => {
    const { invoke, broadcasts } = setup()
    await invoke(companyChannels.create, { folder: onDisk('/work/acme'), name: 'Acme' })

    const updated = await invoke(companyChannels.update, {
      name: 'Acme Labs',
      key: 'ACME',
      bossName: 'Ada Lorne',
      bossInitials: 'AL',
    })

    expect(updated).toMatchObject({
      ok: true,
      value: { name: 'Acme Labs', key: 'ACME', boss: { name: 'Ada Lorne', initials: 'AL' } },
    })
    expect(broadcasts.at(-1)).toMatchObject({ name: 'Acme Labs', key: 'ACME' })
  })

  it('returns bad settings as errors', async () => {
    const { invoke } = setup()
    await invoke(companyChannels.create, { folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(companyChannels.update, null)).toMatchObject({ ok: false })
    expect(await invoke(companyChannels.update, { name: 7 })).toMatchObject({ ok: false })
    expect(await invoke(companyChannels.update, { key: 'acme' })).toEqual({
      ok: false,
      error: expect.stringMatching(/uppercase/),
    })
    expect(await invoke(companyChannels.current)).toMatchObject({ name: 'Acme', key: 'AC' })
  })

  it('hands back the folder the user picked', async () => {
    const { invoke } = setup({ pickedFolder: onDisk('/work/picked') })

    expect(await invoke(companyChannels.pickFolder)).toBe(onDisk('/work/picked'))
  })

  it('forgets a Company and tells every window, even when it was not current', async () => {
    const { invoke, broadcasts } = setup()
    const acme = (await invoke(companyChannels.create, { folder: onDisk('/work/acme'), name: 'Acme' })) as {
      value: Company
    }
    await invoke(companyChannels.create, { folder: onDisk('/work/globex'), name: 'Globex' })
    broadcasts.length = 0

    expect(await invoke(companyChannels.forget, acme.value.id)).toEqual({ ok: true, value: null })
    expect(await invoke(companyChannels.list)).toEqual([expect.objectContaining({ name: 'Globex' })])
    expect(broadcasts).toEqual([expect.objectContaining({ name: 'Globex' })])
  })

  it('reports no current Company once the current one is removed', async () => {
    const { invoke, broadcasts } = setup()
    // Delete removes files, so the Company lives in a scratch folder even with in-memory databases.
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-ipc-'))
    const acme = (await invoke(companyChannels.create, { folder, name: 'Acme' })) as { value: Company }
    broadcasts.length = 0

    expect(await invoke(companyChannels.delete, acme.value.id)).toEqual({ ok: true, value: null })
    expect(await invoke(companyChannels.current)).toBeNull()
    expect(broadcasts).toEqual([null])
    rmSync(folder, { recursive: true, force: true })
  })

  it('refuses to remove an unknown or missing Company', async () => {
    const { invoke } = setup()

    expect(await invoke(companyChannels.forget, 'nope')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Unknown/),
    })
    expect(await invoke(companyChannels.delete, '')).toMatchObject({ ok: false, error: 'Missing Company id' })
  })
})

describe('What the Create step is told about folders (T252)', () => {
  it("hands it the boss's home, so a folder can be suggested without opening the picker", async () => {
    const { invoke } = setup({ homeFolder: onDisk('/home/boss') })

    expect(await invoke(companyChannels.folderHints)).toEqual({ home: onDisk('/home/boss'), syncedRoots: [] })
  })

  it('names the folders OneDrive syncs, from its own variables and never from a folder name', () => {
    expect(
      syncedRoots({
        OneDrive: 'C:\\Users\\boss\\OneDrive',
        OneDriveConsumer: 'C:\\Users\\boss\\OneDrive',
        OneDriveCommercial: 'C:\\Users\\boss\\OneDrive - Acme',
      }),
    ).toEqual(['C:\\Users\\boss\\OneDrive', 'C:\\Users\\boss\\OneDrive - Acme'])
    // A Mac or a Linux box, and a Windows machine without OneDrive: nothing to warn about.
    expect(syncedRoots({})).toEqual([])
    expect(syncedRoots({ OneDrive: '  ' })).toEqual([])
    expect(syncedRoots({ HOME: '/Users/boss/OneDrive' })).toEqual([])
  })
})

describe('The Company logo over IPC (T280)', () => {
  it('makes the picked image the logo, answers it with the Company everywhere, and takes it away', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'company-ipc-logo-'))
    try {
      const { invoke, broadcasts } = setup({ pickedImage: '/Users/boss/mark.png' })
      await invoke(companyChannels.create, { folder, name: 'Acme' })
      const url = `data:image/png;base64,${Buffer.from('png of /Users/boss/mark.png').toString('base64')}`

      expect(await invoke(companyChannels.chooseLogo)).toEqual({ ok: true, value: url })
      expect(await invoke(companyChannels.current)).toMatchObject({ name: 'Acme', logo: url })
      expect(await invoke(companyChannels.list)).toEqual([expect.objectContaining({ logo: url })])
      expect(broadcasts.at(-1)).toMatchObject({ logo: url })

      expect(await invoke(companyChannels.removeLogo)).toEqual({ ok: true, value: null })
      expect(await invoke(companyChannels.current)).toMatchObject({ logo: null })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('changes nothing when the boss cancels the picker', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'company-ipc-logo-'))
    try {
      const { invoke } = setup()
      await invoke(companyChannels.create, { folder, name: 'Acme' })
      expect(await invoke(companyChannels.chooseLogo)).toEqual({ ok: true, value: null })
      expect(await invoke(companyChannels.current)).toMatchObject({ logo: null })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
