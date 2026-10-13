import { afterEach, describe, expect, it } from 'vitest'
import { profileChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryBossProfile, inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerProfileIpc } from './profile-ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    bossProfile: inMemoryBossProfile(),
    bossName: () => 'Yuri Miguel',
  })
  engines.push(engine)
  const broadcasts = { profile: 0, company: 0 }
  registerProfileIpc({
    ipc,
    engine,
    broadcastChanged: () => broadcasts.profile++,
    broadcastCompanyChanged: () => broadcasts.company++,
  })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts }
}

describe('Profile IPC', () => {
  it('reads the profile with no Company open: it is the boss’s, not a Company’s', async () => {
    const { invoke } = setup()

    expect(await invoke(profileChannels.get)).toEqual({
      ok: true,
      value: expect.objectContaining({ name: 'Yuri Miguel', handle: 'yuri', sprite: 0, status: 'available' }),
    })
  })

  it('round-trips a sprite, a status and the sound toggle', async () => {
    const { invoke } = setup()
    const until = Date.now() + 3_600_000

    const saved = await invoke(profileChannels.update, {
      sprite: 4,
      status: 'focused',
      statusUntil: until,
      sound: true,
    })

    expect(saved).toMatchObject({ ok: true, value: { sprite: 4, status: 'focused', statusUntil: until, sound: true } })
    expect(await invoke(profileChannels.get)).toMatchObject({ value: { sprite: 4, status: 'focused' } })
  })

  it('a status whose duration has run out is already cleared when the page reads it', async () => {
    const { invoke } = setup()

    await invoke(profileChannels.update, { status: 'away', statusUntil: Date.now() - 1 })

    expect(await invoke(profileChannels.get)).toMatchObject({ value: { status: 'available', statusUntil: null } })
  })

  it('tells the renderer the profile and every Company changed', async () => {
    const { invoke, broadcasts } = setup()

    await invoke(profileChannels.update, { name: 'Ada Lorne' })

    expect(broadcasts).toEqual({ profile: 1, company: 1 })
  })

  it('reports what is wrong instead of writing it', async () => {
    const { invoke } = setup()

    expect(await invoke(profileChannels.update, { handle: 'Not A Handle' })).toEqual({
      ok: false,
      error: expect.stringMatching(/handle is/),
    })
    expect(await invoke(profileChannels.update, 'nonsense')).toEqual({
      ok: false,
      error: expect.stringMatching(/must be an object/),
    })
    expect(await invoke(profileChannels.get)).toMatchObject({ value: { handle: 'yuri' } })
  })

  it('shows the same profile in every open Company', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    await invoke(profileChannels.update, { name: 'Ada Lorne', sprite: 2 })

    expect(engine.listCompanies().map((company) => company.boss)).toEqual([
      expect.objectContaining({ name: 'Ada Lorne', sprite: 2 }),
      expect.objectContaining({ name: 'Ada Lorne', sprite: 2 }),
    ])
  })
})
