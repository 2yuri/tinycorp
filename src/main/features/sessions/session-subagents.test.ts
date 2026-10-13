import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { createSubagentModel, FINISHED_KEPT } from './subagents'

/**
 * A Session's subagents (T162), end to end through the engine: what a Session's hooks say about
 * the subagents it runs inside its own process, held per Session and handed to the renderer on
 * `SessionInfo`, the way its status is.
 */

const engines: CompanyEngine[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup(options: { subagents?: boolean } = {}): { engine: CompanyEngine; provider: FakeProvider; ada: string } {
  const provider = fakeProvider(options)
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' }).id
  engine.sessions.start(ada)
  provider.spawnOf(ada).hook('SessionStart')
  vi.advanceTimersByTime(1500)
  return { engine, provider, ada }
}

/** The parent asks for a subagent, and it reports in. */
function launch(provider: FakeProvider, employeeId: string, callId: string, agentId: string, description: string) {
  const session = provider.spawnOf(employeeId)
  session.hook('PreToolUse', {
    tool_name: 'Agent',
    tool_use_id: callId,
    tool_input: {
      description,
      prompt: `${description}\nand the rest of a long prompt`,
      subagent_type: 'general-purpose',
    },
  })
  session.hook('SubagentStart', { agent_id: agentId, agent_type: 'general-purpose' })
}

const subagentsOf = (engine: CompanyEngine, employeeId: string) => engine.sessions.get(employeeId).subagents

describe('A Session’s subagents', () => {
  it('shows a subagent the moment its hooks say it runs, with what it is running now', () => {
    const { engine, provider, ada } = setup()

    launch(provider, ada, 'toolu_1', 'agent-1', 'write tests')
    provider.spawnOf(ada).hook('PreToolUse', {
      agent_id: 'agent-1',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm vitest run charts' },
    })

    expect(subagentsOf(engine, ada)).toEqual([
      expect.objectContaining({ name: 'write tests', state: 'running', now: 'pnpm vitest run charts' }),
    ])
  })

  it('marks it done when its stop arrives', () => {
    const { engine, provider, ada } = setup()
    launch(provider, ada, 'toolu_1', 'agent-1', 'write tests')

    provider.spawnOf(ada).hook('SubagentStop', { agent_id: 'agent-1' })

    expect(subagentsOf(engine, ada)).toEqual([expect.objectContaining({ state: 'done' })])
  })

  it('tells the renderer when the strip changes, as it does for status', () => {
    const { engine, provider, ada } = setup()
    const heard: number[] = []
    engine.sessions.onChange(() => heard.push(subagentsOf(engine, ada).length))

    launch(provider, ada, 'toolu_1', 'agent-1', 'write tests')

    expect(heard).toContain(1)
  })

  it('takes every subagent with it when the parent is killed mid-subagent', () => {
    const { engine, provider, ada } = setup()
    launch(provider, ada, 'toolu_1', 'agent-1', 'write tests')

    engine.sessions.stop(ada)

    expect(subagentsOf(engine, ada)).toEqual([])
  })

  it('takes every subagent with it when the parent’s process dies on its own', () => {
    const { engine, provider, ada } = setup()
    launch(provider, ada, 'toolu_1', 'agent-1', 'write tests')

    provider.spawnOf(ada).pty.exit(1)

    expect(subagentsOf(engine, ada)).toEqual([])
    engine.sessions.start(ada)
    expect(subagentsOf(engine, ada)).toEqual([])
  })

  it('reports none for a Provider that has none, whatever its hooks carry', () => {
    const { engine, provider, ada } = setup({ subagents: false })

    launch(provider, ada, 'toolu_1', 'agent-1', 'write tests')

    expect(subagentsOf(engine, ada)).toEqual([])
  })

  it('keeps the last few finished subagents and every running one', () => {
    const { engine, provider, ada } = setup()
    for (let i = 0; i < FINISHED_KEPT + 3; i++) {
      launch(provider, ada, `toolu_${i}`, `agent-${i}`, `task ${i}`)
      provider.spawnOf(ada).hook('SubagentStop', { agent_id: `agent-${i}` })
      vi.advanceTimersByTime(1000)
    }
    launch(provider, ada, 'toolu_live', 'agent-live', 'still going')

    const names = subagentsOf(engine, ada).map((row) => row.name)
    expect(names).toHaveLength(FINISHED_KEPT + 1)
    expect(names.at(-1)).toBe('still going')
    expect(names[0]).toBe('task 3')
  })
})

describe('The subagent model', () => {
  it('shows an agent no call was heard for under its type', () => {
    const model = createSubagentModel()

    model.apply({ kind: 'started', agentId: 'a', type: 'Explore' }, new Date())

    expect(model.list()).toEqual([expect.objectContaining({ name: 'Explore', state: 'running' })])
  })

  it('says nothing changed when nothing did', () => {
    const model = createSubagentModel()

    expect(model.apply({ kind: 'settled', running: null }, new Date())).toBe(false)
    expect(model.apply({ kind: 'started', agentId: 'a', type: null }, new Date())).toBe(true)
  })
})
