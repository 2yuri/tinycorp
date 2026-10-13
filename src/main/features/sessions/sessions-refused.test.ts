import { afterEach, describe, expect, it } from 'vitest'
import type { Provider } from '../../../shared/domain/providers'
import { machineWords } from '../../../shared/platform/machine-words'
import { type ProviderCheck, preflightRefusal } from '../../../shared/providers/preflight'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { createClaudeAdapter } from '../../providers/claude/adapter'
import { createCodexAdapter } from '../../providers/codex/adapter'
import { type FakeProvider, fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/**
 * The engine with the Launcher's own answers in front of it, as `src/main/index.ts` wires it: a
 * cached check per Provider, and `refuseSession` reading the one belonging to the Employee's.
 */
function setup(cached: Partial<Record<Provider, ProviderCheck>>): {
  engine: CompanyEngine
  claude: FakeProvider
  codex: FakeProvider
} {
  const claude = fakeProvider()
  const codex = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude, codex },
    refuseSession: (provider) => preflightRefusal(cached[provider] ?? null),
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  return { engine, claude, codex }
}

/** What a Provider's own adapter really says in `state`, with no CLI on this machine. */
async function checkOf(provider: Provider, state: 'missing' | 'signed-out'): Promise<ProviderCheck> {
  const options = {
    hookUrl: 'http://127.0.0.1:4555/hook',
    dataDir: '/tmp/tinycorp-refused',
    env: { PATH: '/usr/bin' },
    installed: () => state !== 'missing',
    runCli: async () => ({ kind: 'output' as const, code: 1, output: 'Not logged in' }),
  }
  const adapter =
    provider === 'claude'
      ? createClaudeAdapter({ ...options, command: 'claude', name: 'Claude Code' })
      : createCodexAdapter({ ...options, command: 'codex', name: 'Codex' })
  return adapter.checkCli()
}

/** Where the refusal says it looked, the way `missingBody` names the machine (T250). */
const HERE = process.platform === 'win32' ? 'Windows' : machineWords(process.platform).machine

describe('A Session with no CLI to spawn into', () => {
  it('is refused with the sentence the Launcher shows, and nothing is spawned', async () => {
    const { engine, claude } = setup({ claude: await checkOf('claude', 'signed-out') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(() => engine.sessions.start(ada.id)).toThrow(
      'Claude Code is not signed in. TinyCorp found the command, but no subscription login — ' +
        'so no Employee on Claude Code can start.',
    )
    expect(claude.spawns).toHaveLength(0)
    expect(engine.sessions.get(ada.id).status).toBe('off')
  })

  it('says the command is missing when that is what is wrong', async () => {
    const { engine } = setup({ claude: await checkOf('claude', 'missing') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    expect(() => engine.sessions.start(ada.id)).toThrow('Claude Code is not installed.')
  })

  it('refuses an Employee in its own Provider’s words, not the other one’s (T135)', async () => {
    const { engine, claude, codex } = setup({
      claude: await checkOf('claude', 'signed-out'),
      codex: await checkOf('codex', 'missing'),
    })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', provider: 'claude' })
    const grace = engine.employees.create({ name: 'Grace', roleId: 'backend', provider: 'codex' })

    expect(() => engine.sessions.start(ada.id)).toThrow('Claude Code is not signed in.')
    expect(() => engine.sessions.start(grace.id)).toThrow(
      `Codex is not installed. TinyCorp could not find the codex command on ${HERE} — ` +
        'so no Employee on Codex can start.',
    )
    expect(claude.spawns).toHaveLength(0)
    expect(codex.spawns).toHaveLength(0)
  })

  it('never refuses an Employee over another Provider’s trouble (T135)', async () => {
    const { engine, claude } = setup({ codex: await checkOf('codex', 'missing') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend', provider: 'claude' })

    engine.sessions.start(ada.id)

    expect(claude.spawns).toHaveLength(1)
  })

  it('starts as always when the CLI is signed in, and when nobody has asked yet', () => {
    const { engine, claude } = setup({})
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })

    engine.sessions.start(ada.id)

    expect(claude.spawns).toHaveLength(1)
  })
})
