import { routingChannels } from '../../../shared/domain/channels'
import { PROVIDERS } from '../../../shared/domain/providers'
import type { Provider } from '../../../shared/domain/staff'
import type { RoutingSettings } from '../../../shared/ipc'
import type { OutOfProviderRule } from '../../../shared/usage/usage-routing'
import { attempt, type IpcHandlerRegistry } from '../../core'
import type { UsageFacade } from './facade'

export interface RoutingIpcOptions {
  ipc: IpcHandlerRegistry
  engine: UsageFacade
  broadcastChanged(): void
}

/**
 * The Usage & routing tab and the Accounts card (T173). One read gives the whole tab, and every
 * write gives it back, so the renderer never assembles it from four calls.
 */
export function registerRoutingIpc({ ipc, engine, broadcastChanged }: RoutingIpcOptions): void {
  engine.onChange(broadcastChanged)
  engine.accounts.onChange(broadcastChanged)
  engine.capacity.onChange(broadcastChanged)

  function settings(): RoutingSettings {
    const employees = engine.employees.list()
    return {
      routing: engine.usageRouting.get(),
      overrides: engine.usageRouting.overrides().map(({ employeeId, routing }) => ({
        employeeId,
        name: employees.find((employee) => employee.id === employeeId)?.name ?? employeeId,
        routing,
      })),
      accounts: engine.accounts.list(),
      oneAccountProviders: PROVIDERS.filter((provider) => !engine.accounts.supportsAccounts(provider)),
    }
  }

  /** The Providers the boss may name in a rule: the catalogue, and nothing outside it. */
  function checkProvider(provider: unknown): Provider {
    if (typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error(`Unknown Provider: ${String(provider)}`)
    }
    return provider as Provider
  }

  function checkRule(rule: unknown): OutOfProviderRule {
    if (!rule || typeof rule !== 'object') throw new Error('A rule is Wait for reset or Continue on another provider')
    const kind = (rule as { kind?: unknown }).kind
    if (kind === 'wait') return { kind: 'wait' }
    if (kind !== 'continue') throw new Error(`Unknown rule: ${String(kind)}`)
    const provider = checkProvider((rule as { provider?: unknown }).provider)
    const model = (rule as { model?: unknown }).model
    if (model !== null && model !== undefined && typeof model !== 'string')
      throw new Error('A model is text or nothing')
    return { kind: 'continue', provider: provider as Provider, model: model ?? null }
  }

  const changed = <T>(action: () => T): RoutingSettings => {
    action()
    broadcastChanged()
    return settings()
  }

  const text = (value: unknown, what: string): string => {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${what} is missing`)
    return value
  }

  const flag = (value: unknown): boolean => {
    if (typeof value !== 'boolean') throw new Error('That setting is on or off')
    return value
  }

  const accountId = (value: unknown): string | null => {
    if (value === null || value === undefined) return null
    return text(value, 'The account')
  }

  ipc.handle(routingChannels.get, () => attempt(settings))
  ipc.handle(routingChannels.setRule, (_event, provider, rule) =>
    attempt(() => changed(() => engine.usageRouting.setRule(checkProvider(provider), checkRule(rule)))),
  )
  ipc.handle(routingChannels.setMoveBack, (_event, provider, on) =>
    attempt(() => changed(() => engine.usageRouting.setMoveBack(checkProvider(provider), flag(on)))),
  )
  ipc.handle(routingChannels.setResumeAtReset, (_event, on) =>
    attempt(() => changed(() => engine.usageRouting.setResumeAtReset(flag(on)))),
  )
  ipc.handle(routingChannels.setRotateAccounts, (_event, on) =>
    attempt(() => changed(() => engine.usageRouting.setRotateAccounts(flag(on)))),
  )
  ipc.handle(routingChannels.setPinnedAccount, (_event, provider, id) =>
    attempt(() => changed(() => engine.usageRouting.setPinnedAccount(checkProvider(provider), accountId(id)))),
  )
  ipc.handle(routingChannels.setEmployeeRule, (_event, employeeId, rule) =>
    attempt(() =>
      changed(() =>
        engine.usageRouting.setEmployeeRule(text(employeeId, 'The Employee'), rule === null ? null : checkRule(rule)),
      ),
    ),
  )
  ipc.handle(routingChannels.setEmployeePin, (_event, employeeId, provider, id) =>
    attempt(() =>
      changed(() =>
        engine.usageRouting.setEmployeePin(text(employeeId, 'The Employee'), checkProvider(provider), accountId(id)),
      ),
    ),
  )
  ipc.handle(routingChannels.addAccount, (_event, provider, label) =>
    attempt(() => changed(() => engine.accounts.add(checkProvider(provider), text(label, 'The label')))),
  )
  ipc.handle(routingChannels.renameAccount, (_event, id, label) =>
    attempt(() => changed(() => engine.accounts.rename(text(id, 'The account'), text(label, 'The label')))),
  )
  ipc.handle(routingChannels.setDefaultAccount, (_event, id) =>
    attempt(() => changed(() => engine.accounts.setDefault(text(id, 'The account')))),
  )
  ipc.handle(routingChannels.removeAccount, (_event, id) =>
    attempt(() => changed(() => engine.accounts.remove(text(id, 'The account')))),
  )
  ipc.handle(routingChannels.continueNow, (_event, employeeId) =>
    attempt(() => {
      const company = engine.currentCompany()
      if (!company) throw new Error('No Company is open')
      engine.limits.continueNow(company.id, text(employeeId, 'The Employee'))
    }),
  )
  ipc.handle(routingChannels.moveBackNow, (_event, employeeId) =>
    attempt(() => {
      const company = engine.currentCompany()
      if (!company) throw new Error('No Company is open')
      engine.limits.moveBackNow(company.id, text(employeeId, 'The Employee'))
    }),
  )
}
