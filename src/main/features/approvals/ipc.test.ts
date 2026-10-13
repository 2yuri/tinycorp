import { afterEach, describe, expect, it } from 'vitest'
import { approvalChannels } from '../../../shared/domain/channels'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerApprovalIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  let broadcasts = 0
  registerApprovalIpc({ ipc, engine, broadcastChanged: () => broadcasts++ })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, broadcasts: () => broadcasts }
}

function withRequest() {
  const context = setup()
  context.engine.createCompany({ folder: onDisk('/work/acme') })
  const ada = context.engine.employees.create({ name: 'Ada', roleId: 'backend' })
  context.engine.approvals.setLevel('supervised')
  const outcome = context.engine.approvals.request({ requesterId: ada.id, action: 'start', subject: '#12' })
  if (outcome.gate !== 'ask') throw new Error('expected an approval')
  return { ...context, ada, approval: outcome.approval }
}

describe('Approval IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(approvalChannels.level)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('reads and sets the autonomy level', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(approvalChannels.level)).toEqual({ ok: true, value: 'managed' })
    expect(await invoke(approvalChannels.setLevel, 'supervised')).toEqual({ ok: true, value: 'supervised' })
    expect(engine.approvals.level()).toBe('supervised')
    expect(await invoke(approvalChannels.setLevel, 'yolo')).toMatchObject({ ok: false })
  })

  it('lists Approvals, optionally only pending ones', async () => {
    const { invoke, approval } = withRequest()

    expect(await invoke(approvalChannels.list)).toEqual({ ok: true, value: [approval] })
    expect(await invoke(approvalChannels.list, 'pending')).toEqual({ ok: true, value: [approval] })
    expect(await invoke(approvalChannels.list, 'approved')).toEqual({ ok: true, value: [] })
    expect(await invoke(approvalChannels.list, 'maybe')).toMatchObject({ ok: false })
  })

  it('approves as the boss', async () => {
    const { engine, invoke, approval } = withRequest()

    const result = await invoke(approvalChannels.decide, approval.id, { approve: true })

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ id: approval.id, status: 'approved' }) })
    expect(engine.chat().read({ channelId: 'general', threadId: approval.messageId }).at(-1)).toMatchObject({
      authorId: BOSS,
    })
  })

  it('rejects with a reason, and refuses a rejection without one', async () => {
    const { invoke, approval } = withRequest()

    expect(await invoke(approvalChannels.decide, approval.id, { approve: false })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/reason/i),
    })
    expect(await invoke(approvalChannels.decide, approval.id, { approve: false, reason: 'later' })).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'rejected', decisionReason: 'later' }),
    })
  })

  it('refuses a malformed decision', async () => {
    const { invoke, approval } = withRequest()

    expect(await invoke(approvalChannels.decide, 'one', { approve: true })).toMatchObject({ ok: false })
    expect(await invoke(approvalChannels.decide, approval.id, { approve: 'yes' })).toMatchObject({ ok: false })
    expect(await invoke(approvalChannels.decide, approval.id)).toMatchObject({ ok: false })
  })

  it('broadcasts on approval changes and on Company changes', async () => {
    const { engine, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    engine.approvals.setLevel('autonomous')
    engine.createCompany({ folder: onDisk('/work/globex') })

    expect(broadcasts() - before).toBe(2)
  })
})
