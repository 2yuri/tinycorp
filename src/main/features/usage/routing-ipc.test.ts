import { afterEach, describe, expect, it } from 'vitest'
import { routingChannels } from '../../../shared/domain/channels'
import { PROVIDERS } from '../../../shared/domain/providers'
import type { RoutingSettings } from '../../../shared/ipc'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerRoutingIpc } from './routing-ipc'

const [first, second] = PROVIDERS as [string, string]

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const claude = fakeProvider({ accounts: true })
  const codex = fakeProvider({ accounts: true })
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude, codex },
    accountsDir: onDisk('/app/accounts'),
    makeAccountDir: () => {},
  })
  claude.connect(engine.sessions.receiveHook)
  engines.push(engine)
  registerRoutingIpc({ ipc, engine, broadcastChanged: () => {} })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke }
}

/** The settings out of a successful call, so a test reads what the tab would draw. */
const value = (result: unknown) => (result as { ok: true; value: RoutingSettings }).value

describe('Routing IPC', () => {
  it('answers the whole tab in one read: rules, overrides and accounts', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    engine.usageRouting.setEmployeeRule(ada.id, { kind: 'wait' })

    const settings = value(await invoke(routingChannels.get))

    expect(settings.routing.resumeAtReset).toBe(true)
    expect(settings.routing.rotateAccounts).toBe(false)
    expect(settings.overrides).toEqual([
      { employeeId: ada.id, name: 'Ada', routing: { rule: { kind: 'wait' }, pinnedAccount: {} } },
    ])
    // Each Provider that holds more than one sign-in already has its own, before the boss adds any.
    expect(settings.accounts.map((account) => account.provider)).toEqual([first, second])
  })

  it('gives the tab back on every write, so nothing is assembled in the renderer', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    const after = value(
      await invoke(routingChannels.setRule, first, { kind: 'continue', provider: second, model: null }),
    )

    expect(after.routing.rules[first]).toEqual({ kind: 'continue', provider: second, model: null })
  })

  it('refuses a Provider and a rule it does not know', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(routingChannels.setRule, 'not-a-provider', { kind: 'wait' })).toEqual({
      ok: false,
      error: expect.stringMatching(/unknown provider/i),
    })
    expect(await invoke(routingChannels.setRule, first, { kind: 'shrug' })).toEqual({
      ok: false,
      error: expect.stringMatching(/unknown rule/i),
    })
    expect(await invoke(routingChannels.setResumeAtReset, 'yes')).toEqual({
      ok: false,
      error: expect.stringMatching(/on or off/i),
    })
  })

  /** Every account has a name the boss gave it, the first one included (T263). */
  it('adds an account under the name it was given, and renames the first one and an added one', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const added = value(await invoke(routingChannels.addAccount, first, 'Side project'))
    const side = added.accounts.find((account) => account.label === 'Side project')!
    const primary = added.accounts.find((account) => account.provider === first && account.primary)!

    await invoke(routingChannels.renameAccount, primary.id, 'Home')
    const renamed = value(await invoke(routingChannels.renameAccount, side.id, 'Client'))

    expect(renamed.accounts.filter((account) => account.provider === first).map((account) => account.label)).toEqual([
      'Home',
      'Client',
    ])
  })
})
