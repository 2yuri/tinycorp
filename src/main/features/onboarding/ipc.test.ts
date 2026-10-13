import { afterEach, describe, expect, it } from 'vitest'
import { onboardingChannels } from '../../../shared/domain/channels'
import type { OnboardingDraft } from '../../../shared/onboarding'
import { rosterFromPreset } from '../../../shared/staff/roster-draft'
import { teamPreset } from '../../../shared/staff/team-presets'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { IpcHandlerRegistry } from '../../core/ipc-kit'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { registerOnboardingIpc } from './ipc'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc: IpcHandlerRegistry = {
    handle: (channel, handler) => handlers.set(channel, (...args) => handler({}, ...args)),
  }
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  registerOnboardingIpc({ ipc, engine })
  const invoke = async (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { engine, invoke }
}

describe('Onboarding IPC', () => {
  it('reports an error while no Company is open', async () => {
    const { invoke } = setup()

    expect(await invoke(onboardingChannels.finish, { hires: [], goal: null })).toEqual({
      ok: false,
      error: expect.stringMatching(/no company is open/i),
    })
  })

  it('finishes with the hires and the goal, ignoring fields a hire may not carry', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    const result = await invoke(onboardingChannels.finish, {
      hires: [{ name: 'Hera', roleId: 'pm', model: 'opus-5-balanced', capabilities: ['code'] }],
      goal: 'Set up CI and a preview deploy',
    })

    expect(result).toMatchObject({ ok: true, value: { hired: [{ name: 'Hera' }] } })
    expect(engine.employees.list()).toMatchObject([
      { name: 'Hera', model: 'opus-5-balanced', capabilities: ['intake', 'plan', 'hire'] },
    ])
    expect(engine.onboarding.completedAt()).not.toBeNull()
  })

  it('reads the progress of the current Company, and stores the step the wizard is on', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const draft: OnboardingDraft = {
      step: 'team',
      preset: 'solo-builder',
      roster: rosterFromPreset(teamPreset('solo-builder'), 'claude'),
      goal: 'Migrate the API to Postgres',
    }

    expect(await invoke(onboardingChannels.progress)).toEqual({ ok: true, value: { completedAt: null, draft: null } })
    expect(await invoke(onboardingChannels.save, draft)).toEqual({ ok: true, value: null })
    expect(await invoke(onboardingChannels.progress)).toEqual({ ok: true, value: { completedAt: null, draft } })
  })

  it('refuses a step it cannot recognise, leaving the stored one alone', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })
    const draft: OnboardingDraft = {
      step: 'repositories',
      preset: 'product-squad',
      roster: rosterFromPreset(teamPreset('product-squad'), 'claude'),
      goal: '',
    }
    await invoke(onboardingChannels.save, draft)

    expect(await invoke(onboardingChannels.save, { ...draft, step: 'billing' })).toMatchObject({ ok: false })
    expect(await invoke(onboardingChannels.save, { ...draft, preset: 'mega-corp' })).toMatchObject({ ok: false })
    expect(await invoke(onboardingChannels.save, { ...draft, roster: [{ name: 'Hera' }] })).toMatchObject({ ok: false })
    expect(await invoke(onboardingChannels.save, null)).toMatchObject({ ok: false })
    expect(await invoke(onboardingChannels.progress)).toMatchObject({ value: { draft } })
  })

  it('refuses a malformed request without finishing', async () => {
    const { engine, invoke } = setup()
    engine.createCompany({ folder: onDisk('/work/acme') })

    expect(await invoke(onboardingChannels.finish, { hires: [{ name: 3 }], goal: null })).toMatchObject({ ok: false })
    expect(await invoke(onboardingChannels.finish, { hires: [], goal: 7 })).toMatchObject({ ok: false })
    expect(await invoke(onboardingChannels.finish, null)).toMatchObject({ ok: false })
    expect(engine.onboarding.completedAt()).toBeNull()
  })
})
