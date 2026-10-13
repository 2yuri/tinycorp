import { afterEach, describe, expect, it } from 'vitest'
import { notificationChannels } from '../../../shared/domain/channels'
import type { NotificationFocusRequest } from '../../../shared/ipc'
import type { CompanyNotification, NotificationAction, NotificationDelivery } from '../../../shared/notifications'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { registerNotificationIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function setup(system: { delivery?: NotificationDelivery; supported?: boolean } = {}) {
  const { delivery = { status: 'accepted' } as NotificationDelivery, supported = true } = system
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
  engines.push(engine)
  const shown: { notification: CompanyNotification; click(): void; act(id: NotificationAction['id']): void }[] = []
  const focused: NotificationFocusRequest[] = []
  const openedSettings: number[] = []
  let broadcasts = 0
  registerNotificationIpc({
    ipc,
    engine,
    show: (notification, click, act) => {
      shown.push({ notification, click, act })
      return Promise.resolve(delivery)
    },
    supported: () => supported,
    openSystemSettings: () => {
      openedSettings.push(1)
      return Promise.resolve(process.platform !== 'linux')
    },
    focus: (request) => focused.push(request),
    broadcastChanged: () => broadcasts++,
    log: () => {},
  })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke, shown, focused, openedSettings, broadcasts: () => broadcasts }
}

describe('Notification IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(notificationChannels.enabled)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('reads and sets the current Company’s toggle', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(notificationChannels.enabled)).toEqual({ ok: true, value: true })
    expect(await invoke(notificationChannels.setEnabled, false)).toEqual({ ok: true, value: false })
    expect(await invoke(notificationChannels.enabled)).toEqual({ ok: true, value: false })
    expect(await invoke(notificationChannels.setEnabled, 'off')).toEqual({
      ok: false,
      error: expect.stringMatching(/on or off/),
    })
  })

  it('broadcasts on toggle changes and on Company changes', async () => {
    const { engine, invoke, broadcasts } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const before = broadcasts()

    await invoke(notificationChannels.setEnabled, false)
    await invoke(notificationChannels.setEnabled, 'off')
    engine.createCompany({ folder: onDisk('/work/globex') })

    expect(broadcasts() - before).toBe(2)
  })

  it('shows each notification natively, and a click brings its Company forward and focuses the target', async () => {
    const { engine, shown, focused } = setup()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const request = engine.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'A designer' })
    await settle()
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    expect(shown.map((s) => s.notification.title)).toEqual(['Approval requested'])
    expect(focused).toEqual([])
    shown[0]!.click()

    if (request.gate !== 'ask') throw new Error('hire should ask under Managed')
    expect(engine.currentCompany()?.id).toBe(acme.id)
    expect(focused).toEqual([
      {
        companyId: acme.id,
        focus: {
          kind: 'thread',
          channelId: 'general',
          threadId: request.approval.messageId,
          messageId: expect.any(Number),
        },
      },
    ])
  })

  it('approves from the notification’s Approve action, in the Company that asked', async () => {
    const { engine, shown, focused } = setup()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const request = engine.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'A designer' })
    await settle()
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    if (request.gate !== 'ask') throw new Error('hire should ask under Managed')

    shown[0]!.act('approve')

    expect(engine.currentCompany()?.id).toBe(acme.id)
    expect(engine.approvals.list().find((a) => a.id === request.approval.id)?.status).toBe('approved')
    expect(focused).toEqual([])
  })

  it('takes the boss nowhere on Later: what the banner was about waits where it is (T172)', async () => {
    const { engine, shown, focused } = setup()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const request = engine.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'A designer' })
    await settle()
    const globex = engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    if (request.gate !== 'ask') throw new Error('hire should ask under Managed')

    shown[0]!.act('later')

    // Nowhere to go, nothing decided, and the Company the boss was in stays the current one.
    expect(focused).toEqual([])
    expect(engine.currentCompany()?.id).toBe(globex.id)
    engine.switchCompany(acme.id)
    expect(engine.approvals.list().find((a) => a.id === request.approval.id)?.status).toBe('pending')
  })

  it('opens the thread on Reject, where the boss writes the reason', async () => {
    const { engine, shown, focused } = setup()
    const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const request = engine.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'A designer' })
    await settle()
    if (request.gate !== 'ask') throw new Error('hire should ask under Managed')

    shown[0]!.act('reject')

    expect(engine.approvals.list().find((a) => a.id === request.approval.id)?.status).toBe('pending')
    expect(focused).toEqual([
      {
        companyId: acme.id,
        focus: {
          kind: 'thread',
          channelId: 'general',
          threadId: request.approval.messageId,
          messageId: expect.any(Number),
        },
      },
    ])
  })

  it('opens the thread when an approval was already decided', async () => {
    const { engine, shown, focused } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const request = engine.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'A designer' })
    await settle()
    if (request.gate !== 'ask') throw new Error('hire should ask under Managed')
    engine.approvals.decide(request.approval.id, { approve: false, reason: 'Not now' })

    shown[0]!.act('approve')

    expect(focused).toHaveLength(1)
  })

  it('sends the test banner through the path a real notification takes, and answers with what happened', async () => {
    const { engine, invoke, shown } = setup({ delivery: { status: 'accepted' } })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    const result = await invoke(notificationChannels.test)

    expect(shown.map((s) => s.notification)).toEqual([
      expect.objectContaining({ kind: 'test', title: 'Test notification' }),
    ])
    expect(result).toEqual({ ok: true, value: { status: 'accepted' } })
  })

  it('brings a refusal back as a refusal rather than as silence', async () => {
    const refusal = { status: 'refused', reason: 'Notifications are not allowed for this application' } as const
    const { engine, invoke } = setup({ delivery: refusal })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(notificationChannels.test)).toEqual({ ok: true, value: refusal })
    expect(await invoke(notificationChannels.delivery)).toEqual({ ok: true, value: refusal })
  })

  it('remembers what the system did with a real notification, and says so on a change', async () => {
    const refusal = { status: 'refused', reason: 'Not authorized' } as const
    const { engine, invoke, broadcasts } = setup({ delivery: refusal })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    expect(await invoke(notificationChannels.delivery)).toEqual({ ok: true, value: null })
    const before = broadcasts()

    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'A designer' })
    await settle()
    await settle()

    expect(await invoke(notificationChannels.delivery)).toEqual({ ok: true, value: refusal })
    expect(broadcasts() - before).toBe(1)
  })

  it('knows the platform cannot post banners before anything is sent', async () => {
    const { engine, invoke } = setup({ supported: false })
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })

    expect(await invoke(notificationChannels.delivery)).toEqual({ ok: true, value: { status: 'unsupported' } })
  })

  it('sends no test while the Company has notifications off, and does not blame the system for it', async () => {
    const { engine, invoke, shown } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    await invoke(notificationChannels.setEnabled, false)

    expect(await invoke(notificationChannels.test)).toEqual({ ok: true, value: { status: 'off' } })
    expect(shown).toEqual([])
    expect(await invoke(notificationChannels.delivery)).toEqual({ ok: true, value: null })
  })

  it('reports an error when a test is asked for with no Company open', async () => {
    const { invoke } = setup()

    expect(await invoke(notificationChannels.test)).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('opens the system notification settings on request', async () => {
    const { invoke, openedSettings } = setup()

    expect(await invoke(notificationChannels.openSystemSettings)).toEqual({
      ok: true,
      value: process.platform !== 'linux',
    })
    expect(openedSettings).toEqual([1])
  })
})
