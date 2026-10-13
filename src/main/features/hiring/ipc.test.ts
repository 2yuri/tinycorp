import { afterEach, describe, expect, it } from 'vitest'
import { hiringChannels } from '../../../shared/domain/channels'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerHiringIpc } from './ipc'

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
    log: () => {},
  })
  engines.push(engine)
  registerHiringIpc({ ipc, engine })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke }
}

function withStaff() {
  const context = setup()
  context.engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = context.engine.employees.create({ name: 'Ada', roleId: 'backend' })
  return { ...context, ada }
}

describe('Hiring IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(hiringChannels.teamLoad)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('reads the team load', async () => {
    const { invoke, ada } = withStaff()

    expect(await invoke(hiringChannels.teamLoad)).toEqual({
      ok: true,
      value: expect.objectContaining({ employees: [expect.objectContaining({ id: ada.id, wip: 0 })] }),
    })
  })

  it('changes the model of a pending hire proposal', async () => {
    const { engine, invoke } = withStaff()
    const pam = engine.employees.create({ name: 'Pam', roleId: 'hr' })
    const outcome = engine.hiring.requestHire({ requesterId: pam.id, role: 'QA', reason: 'Bugs' })

    expect(await invoke(hiringChannels.setRequestModel, outcome.request.id, 'sonnet-5-fast')).toEqual({
      ok: true,
      value: expect.objectContaining({ id: outcome.request.id, model: 'sonnet-5-fast' }),
    })
    expect(await invoke(hiringChannels.setRequestModel, String(outcome.request.id), null)).toMatchObject({ ok: false })
    expect(await invoke(hiringChannels.setRequestModel, outcome.request.id, 3)).toMatchObject({ ok: false })
  })

  it('lists hire and fire requests', async () => {
    const { engine, invoke, ada } = withStaff()
    const pam = engine.employees.create({ name: 'Pam', roleId: 'hr' })
    engine.hiring.requestFire({ requesterId: pam.id, employeeId: ada.id, reason: 'Idle' })

    expect(await invoke(hiringChannels.requests)).toEqual({
      ok: true,
      value: [expect.objectContaining({ kind: 'fire', requesterId: pam.id, employeeId: ada.id, status: 'pending' })],
    })
  })

  it('fires as the boss, with a reason, and lists former Employees', async () => {
    const { engine, invoke, ada } = withStaff()

    const fired = await invoke(hiringChannels.fire, ada.id, 'Project over')

    expect(fired).toEqual({ ok: true, value: expect.objectContaining({ id: ada.id }) })
    expect(engine.employees.list()).toEqual([])
    expect(engine.chat().read({ channelId: 'general' }).at(-1)!.text).toContain('Project over')
    expect(await invoke(hiringChannels.former)).toEqual({
      ok: true,
      value: [expect.objectContaining({ id: ada.id, name: 'Ada' })],
    })
  })

  it('rehires as the boss', async () => {
    const { engine, invoke, ada } = withStaff()
    engine.hiring.fire(ada.id)

    expect(await invoke(hiringChannels.rehire, ada.id)).toEqual({
      ok: true,
      value: expect.objectContaining({ id: ada.id }),
    })
    expect(engine.employees.list().map((e) => e.id)).toEqual([ada.id])
  })

  it('edits a pending hire proposal as the boss', async () => {
    const { engine, invoke } = withStaff()
    const hera = engine.employees.create({ name: 'Hera', roleId: 'hr' })
    engine.hiring.requestHire({ requesterId: hera.id, role: 'frontend', reason: 'UI backlog' })
    const [request] = engine.hiring.requests()

    expect(await invoke(hiringChannels.updateProposal, request!.id, { name: 'Lyra', repoFilter: ['web'] })).toEqual({
      ok: true,
      value: expect.objectContaining({ proposal: expect.objectContaining({ name: 'Lyra', repoFilter: ['web'] }) }),
    })
    expect(await invoke(hiringChannels.updateProposal, String(request!.id), { name: 'Zed' })).toMatchObject({
      ok: false,
    })
    expect(await invoke(hiringChannels.updateProposal, request!.id, 'Zed')).toMatchObject({ ok: false })
  })

  it('suggests a free name from the engine', async () => {
    const { invoke } = withStaff()

    expect(await invoke(hiringChannels.suggestName)).toEqual({
      ok: true,
      value: expect.stringMatching(/^\p{Lu}\p{L}+$/u),
    })
  })

  it('suggests a name outside the given list, and refuses a list that is not strings', async () => {
    const { invoke } = withStaff()
    const draft = ['Nova', 'Iris', 'Milo', 'Theo', 'Luna', 'Remy', 'Juno', 'Otto', 'Vera', 'Hugo']

    for (let i = 0; i < 20; i++) {
      const result = await invoke(hiringChannels.suggestName, draft)
      expect(result).toMatchObject({ ok: true })
      expect(draft).not.toContain((result as { value: string }).value)
    }
    expect(await invoke(hiringChannels.suggestName, 'Nova')).toMatchObject({ ok: false })
    expect(await invoke(hiringChannels.suggestName, [1])).toMatchObject({ ok: false })
  })

  it('reads and sets the maximum headcount', async () => {
    const { invoke } = withStaff()

    expect(await invoke(hiringChannels.headcount)).toEqual({ ok: true, value: { current: 1, max: null } })
    expect(await invoke(hiringChannels.setMaxHeadcount, 4)).toEqual({ ok: true, value: { current: 1, max: 4 } })
    expect(await invoke(hiringChannels.setMaxHeadcount, null)).toEqual({ ok: true, value: { current: 1, max: null } })
    expect(await invoke(hiringChannels.setMaxHeadcount, '4')).toMatchObject({ ok: false })
    expect(await invoke(hiringChannels.setMaxHeadcount)).toMatchObject({ ok: false })
  })

  it('refuses malformed input', async () => {
    const { invoke, ada } = withStaff()

    expect(await invoke(hiringChannels.fire)).toMatchObject({ ok: false })
    expect(await invoke(hiringChannels.fire, ada.id, 42)).toMatchObject({ ok: false })
    expect(await invoke(hiringChannels.rehire, ada.id)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown former employee/i),
    })
  })
})
