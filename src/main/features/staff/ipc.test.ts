import { afterEach, describe, expect, it } from 'vitest'
import { staffChannels } from '../../../shared/domain/channels'
import { CHARACTER_SHEETS } from '../../../shared/office/characters'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerStaffIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  let broadcasts = 0
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
  })
  engines.push(engine)
  registerStaffIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler(...args)
  }
  return { engine, invoke, broadcasts: () => broadcasts }
}

describe('Staff IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(staffChannels.roles)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('lists roles, hires from one and lists the Employee', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    // A new Company holds no roles (T240): QA arrives with the Employee hired into it.
    expect(await invoke(staffChannels.roles)).toMatchObject({ ok: true, value: [] })
    const hired = await invoke(staffChannels.hire, {
      name: 'Grace',
      roleId: 'qa',
      permissionMode: 'interactive',
    })

    expect(hired).toMatchObject({
      ok: true,
      value: { name: 'Grace', title: 'QA', permissionMode: 'interactive' },
    })
    expect(await invoke(staffChannels.roles)).toMatchObject({ ok: true, value: [{ id: 'qa', name: 'QA' }] })
    expect(await invoke(staffChannels.employees)).toMatchObject({
      ok: true,
      value: [{ name: 'Grace' }],
    })
  })

  it('creates and edits roles and edits Employees', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    const created = (await invoke(staffChannels.createRole, {
      name: 'Designer',
      persona: 'Draws.',
      capabilities: ['plan'],
      repoFilter: [],
    })) as { ok: true; value: { id: string } }
    const edited = await invoke(staffChannels.updateRole, created.value.id, { repoFilter: ['*web*'] })
    const hired = (await invoke(staffChannels.hire, {
      name: 'Ada',
      roleId: created.value.id,
    })) as { ok: true; value: { id: string } }
    const renamed = await invoke(staffChannels.updateEmployee, hired.value.id, { name: 'Ada L.' })

    expect(edited).toMatchObject({ ok: true, value: { name: 'Designer', repoFilter: ['*web*'] } })
    expect(renamed).toMatchObject({ ok: true, value: { name: 'Ada L.', title: 'Designer' } })
  })

  it('creates a role from a built-in template, keeping the template’s id', async () => {
    const { invoke, engine } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    const created = await invoke(staffChannels.createRole, {
      templateId: 'qa',
      name: 'QA',
      persona: 'Tests it in the running app.',
      capabilities: ['review', 'test'],
      repoFilter: ['*'],
    })

    expect(created).toMatchObject({ ok: true, value: { id: 'qa', name: 'QA', seeded: true } })
  })

  it('deletes a role, refuses one that is held, and takes it once they are moved', async () => {
    const { invoke, engine } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(staffChannels.hire, { name: 'Iris', roleId: 'qa' })

    expect(await invoke(staffChannels.deleteRole, 'qa')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Iris is on it/),
    })
    expect(await invoke(staffChannels.deleteRole, 'qa', { reassignTo: 'backend' })).toMatchObject({ ok: true })
    expect(engine.roles.list().map((r) => r.id)).toEqual(['backend'])
  })

  it('removes the built-in roles nobody uses, and answers their names', async () => {
    const { invoke, engine } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(staffChannels.hire, { name: 'Hera', roleId: 'pm' })
    engine.roles.ensure(['qa'])

    expect(await invoke(staffChannels.removeUnusedRoles)).toEqual({ ok: true, value: ['QA'] })
    expect(engine.roles.list().map((r) => r.id)).toEqual(['pm'])
  })

  it('hires with a model and changes it back to the default', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    const hired = (await invoke(staffChannels.hire, {
      name: 'Lyra',
      roleId: 'frontend',
      model: 'opus-5-balanced',
    })) as { ok: true; value: { id: string; model: string | null } }
    expect(hired).toMatchObject({ ok: true, value: { model: 'opus-5-balanced' } })

    expect(await invoke(staffChannels.updateEmployee, hired.value.id, { model: null })).toMatchObject({
      ok: true,
      value: { model: null },
    })
    expect(await invoke(staffChannels.updateEmployee, hired.value.id, { model: 7 })).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.updateEmployee, hired.value.id, { model: 'gpt-9' })).toMatchObject({ ok: false })
  })

  it('rejects malformed input from the renderer', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(staffChannels.hire, null)).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.hire, { name: 'X', roleId: 7 })).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.createRole, { name: 'X' })).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.updateRole, 'pm', 'nope')).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.updateEmployee, undefined, {})).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.hire, { name: 'X', roleId: 'pm', persona: 3 })).toMatchObject({
      ok: false,
    })
    expect(engine.employees.list()).toEqual([])
  })

  it('hires on the character the hire modal picked, and rejects one that is not a sheet', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(staffChannels.hire, { name: 'Lyra', roleId: 'pm', sprite: 4 })).toMatchObject({
      ok: true,
      value: { sprite: 4 },
    })
    expect(await invoke(staffChannels.hire, { name: 'Nia', roleId: 'pm', sprite: 'four' })).toMatchObject({
      ok: false,
    })
    expect(await invoke(staffChannels.hire, { name: 'Nia', roleId: 'pm', sprite: CHARACTER_SHEETS })).toMatchObject({
      ok: false,
    })
    expect(engine.employees.list().map((e) => e.name)).toEqual(['Lyra'])
  })

  it('ignores fields the renderer may not set', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    const hired = (await invoke(staffChannels.hire, { name: 'Ada', roleId: 'pm', desk: 99 })) as {
      ok: true
      value: { id: string; desk: number }
    }
    await invoke(staffChannels.updateEmployee, hired.value.id, { desk: 42 })

    expect(engine.employees.list()).toEqual([expect.objectContaining({ desk: 0, sprite: 0 })])
  })

  it('carries a character through an edit, and refuses one that is not a sheet', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'pm', sprite: 1 })

    expect(await invoke(staffChannels.updateEmployee, ada.id, { sprite: 5 })).toMatchObject({
      ok: true,
      value: { sprite: 5 },
    })
    expect(await invoke(staffChannels.updateEmployee, ada.id, { sprite: CHARACTER_SHEETS })).toMatchObject({
      ok: false,
    })
    expect(await invoke(staffChannels.updateEmployee, ada.id, { sprite: 'five' })).toMatchObject({ ok: false })
    // An edit that never mentions the character leaves it where the last one put it.
    await invoke(staffChannels.updateEmployee, ada.id, { name: 'Ada L.' })
    expect(engine.employees.list()).toEqual([expect.objectContaining({ name: 'Ada L.', sprite: 5 })])
  })

  it('carries a role change to the engine, and refuses one the catalog does not hold (T138)', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'frontend', persona: 'Mine.' })

    const moved = await invoke(staffChannels.updateEmployee, ada.id, { roleId: 'qa' })

    expect(moved).toMatchObject({ ok: true, value: { roleId: 'qa', title: 'QA', persona: 'Mine.' } })
    expect(await invoke(staffChannels.updateEmployee, ada.id, { roleId: 'nope' })).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.updateEmployee, ada.id, { roleId: 7 })).toMatchObject({ ok: false })
  })

  it('broadcasts when staff or the current Company changes', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    await invoke(staffChannels.hire, { name: 'Ada', roleId: 'pm' })

    expect(broadcasts()).toBe(2)
  })

  it('resets an Employee field to follow its role, and broadcasts role edits', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', persona: 'Mine.' })

    const reset = await invoke(staffChannels.updateEmployee, ada.id, { followRole: ['persona'] })
    const before = broadcasts()
    await invoke(staffChannels.updateRole, 'backend', { persona: 'Edited.' })

    expect(reset).toMatchObject({ ok: true, value: { overrides: [] } })
    expect(broadcasts()).toBeGreaterThan(before)
    expect(await invoke(staffChannels.employees)).toMatchObject({
      ok: true,
      value: [{ name: 'Ada', persona: 'Edited.' }],
    })
    expect(await invoke(staffChannels.updateEmployee, ada.id, { followRole: 'persona' })).toEqual({
      ok: false,
      error: 'Missing fields to follow',
    })
  })
})

describe('the Company’s permission default over IPC (T164)', () => {
  it('reads it, sets it, and refuses a mode the app does not know', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(staffChannels.permissionDefault)).toEqual({ ok: true, value: 'skip-permissions' })
    expect(await invoke(staffChannels.setPermissionDefault, 'interactive')).toEqual({
      ok: true,
      value: 'interactive',
    })
    expect(await invoke(staffChannels.permissionDefault)).toEqual({ ok: true, value: 'interactive' })
    expect(await invoke(staffChannels.setPermissionDefault, 'yolo')).toMatchObject({ ok: false })
    expect(await invoke(staffChannels.permissionDefault)).toEqual({ ok: true, value: 'interactive' })
  })
})
