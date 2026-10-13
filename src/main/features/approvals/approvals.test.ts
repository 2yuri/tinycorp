import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AutonomyLevel, GateConditions, GatedAction } from '../../../shared/approvals'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const engines: CompanyEngine[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

function setup() {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'tech-lead' })

  function startIdle(employeeId: string) {
    engine.sessions.start(employeeId)
    const session = provider.spawnOf(employeeId)
    session.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return session
  }

  const askToStart = (requesterId = ada.id) =>
    engine.approvals.request({
      requesterId,
      action: 'start',
      subject: '#12 Login page',
      reason: 'It is the top of Todo',
    })

  return { engine, provider, acme, ada, grace, startIdle, askToStart }
}

/** Asks and expects an Approval to be created. */
function pendingApproval(outcome: ReturnType<CompanyEngine['approvals']['request']>) {
  if (outcome.gate !== 'ask') throw new Error(`Expected an Approval, got ${outcome.gate}`)
  return outcome.approval
}

describe('Autonomy level', () => {
  it('is Managed for a new Company', () => {
    const { engine } = setup()

    expect(engine.approvals.level()).toBe('managed')
  })

  it('is kept per Company, across switching away and back', () => {
    const { engine, acme } = setup()
    engine.approvals.setLevel('supervised')

    engine.createCompany({ folder: onDisk('/work/globex') })
    expect(engine.approvals.level()).toBe('managed')
    engine.switchCompany(acme.id)

    expect(engine.approvals.level()).toBe('supervised')
  })

  it('survives closing and reopening the Company', () => {
    const folder = mkdtempSync(join(tmpdir(), 'approvals-'))
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }))
    const first = createCompanyEngine({ recents: inMemoryRecents() })
    first.createCompany({ folder })
    first.approvals.setLevel('autonomous')
    first.close()
    const second = createCompanyEngine({ recents: inMemoryRecents() })
    engines.push(second)

    second.openCompany(folder)

    expect(second.approvals.level()).toBe('autonomous')
  })

  it('rejects an unknown level', () => {
    const { engine } = setup()

    expect(() => engine.approvals.setLevel('reckless' as AutonomyLevel)).toThrow(/unknown autonomy level/i)
    expect(engine.approvals.level()).toBe('managed')
  })

  it('tells listeners when it changes', () => {
    const { engine } = setup()
    const listener = vi.fn()
    engine.approvals.onChange(listener)

    engine.approvals.setLevel('supervised')

    expect(listener).toHaveBeenCalled()
  })

  it('throws while no Company is open', () => {
    const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
    engines.push(engine)

    expect(() => engine.approvals.level()).toThrow(/no company is open/i)
  })
})

describe('Autonomy gate', () => {
  const table: [GatedAction, GateConditions, Record<AutonomyLevel, 'free' | 'ask'>][] = [
    ['ticket_create', {}, { supervised: 'free', managed: 'free', autonomous: 'free' }],
    ['ticket_reorder', {}, { supervised: 'free', managed: 'free', autonomous: 'free' }],
    ['assign', {}, { supervised: 'ask', managed: 'free', autonomous: 'free' }],
    ['start', {}, { supervised: 'ask', managed: 'free', autonomous: 'free' }],
    ['open_pr', {}, { supervised: 'ask', managed: 'ask', autonomous: 'free' }],
    ['open_pr', { ciRed: true }, { supervised: 'ask', managed: 'ask', autonomous: 'ask' }],
    ['merge', {}, { supervised: 'ask', managed: 'ask', autonomous: 'free' }],
    ['merge', { ciRed: true }, { supervised: 'ask', managed: 'ask', autonomous: 'ask' }],
    ['merge', { limitExceeded: true }, { supervised: 'ask', managed: 'ask', autonomous: 'ask' }],
    ['hire', {}, { supervised: 'ask', managed: 'ask', autonomous: 'free' }],
    ['hire', { aboveHeadcount: true }, { supervised: 'ask', managed: 'ask', autonomous: 'ask' }],
    ['fire', {}, { supervised: 'ask', managed: 'ask', autonomous: 'ask' }],
    ['switch_provider', {}, { supervised: 'ask', managed: 'ask', autonomous: 'ask' }],
    ['process_change', {}, { supervised: 'ask', managed: 'ask', autonomous: 'free' }],
    ['other', {}, { supervised: 'ask', managed: 'ask', autonomous: 'ask' }],
  ]

  it.each(table)('%s %o follows the spec table', (action, conditions, expected) => {
    const { engine } = setup()
    const actual: Record<string, string> = {}
    for (const level of ['supervised', 'managed', 'autonomous'] as const) {
      engine.approvals.setLevel(level)
      actual[level] = engine.approvals.gate(action, conditions)
    }

    expect(actual).toEqual(expected)
  })

  it('lets a free action through without an Approval or a message', () => {
    const { engine, askToStart } = setup()

    const outcome = askToStart()

    expect(outcome).toEqual({ gate: 'free', level: 'managed' })
    expect(engine.approvals.list()).toEqual([])
    expect(engine.chat().read({ channelId: 'general' })).toEqual([])
  })

  it('rejects an unknown action', () => {
    const { engine, ada } = setup()

    expect(() =>
      engine.approvals.request({ requesterId: ada.id, action: 'deploy' as GatedAction, subject: 'prod' }),
    ).toThrow(/unknown action/i)
  })
})

describe('Approval requests', () => {
  it('creates a pending Approval and a chat thread asking the boss', () => {
    const { engine, ada, askToStart } = setup()
    engine.approvals.setLevel('supervised')

    const approval = pendingApproval(askToStart())

    expect(approval).toMatchObject({
      action: 'start',
      requesterId: ada.id,
      subject: '#12 Login page',
      reason: 'It is the top of Todo',
      status: 'pending',
      decisionReason: null,
    })
    expect(engine.approvals.list()).toEqual([approval])
    const [root] = engine.chat().read({ channelId: approval.channelId })
    expect(root).toMatchObject({ id: approval.messageId, authorId: ada.id, mentions: [BOSS] })
    // One sentence, the boss as a mention and never in the text; the reason lives on the card (decision 42).
    expect(root!.text).toBe("I'd like to start work on #12 Login page.")
  })

  it('posts the requester’s own sentence, with the boss carried as a mention', () => {
    const { engine, ada } = setup()
    engine.approvals.setLevel('supervised')

    const approval = pendingApproval(
      engine.approvals.request({
        requesterId: ada.id,
        action: 'start',
        subject: '#12 Login page',
        reason: 'It is the top of Todo',
        summary: '@boss Login page is top of Todo,\n   so I’d start it now.',
      }),
    )

    const [root] = engine.chat().read({ channelId: approval.channelId })
    expect(root!.text).toBe('Login page is top of Todo, so I’d start it now.')
    expect(root!.mentions).toEqual([BOSS])
    expect(root!.text).not.toContain('@')
  })

  it('never posts the raw template, whatever the kind', () => {
    const { engine, ada } = setup()
    engine.approvals.setLevel('supervised')
    const ticketId = engine.board().createTicket({ title: 'Login page' }).id
    const kinds: GatedAction[] = ['start', 'open_pr', 'merge', 'hire', 'fire', 'switch_provider', 'other']

    for (const action of kinds) {
      const outcome = engine.approvals.request({
        requesterId: ada.id,
        action,
        subject: 'a Designer',
        ticketId,
        reason: 'why',
      })
      if (outcome.gate !== 'ask') continue
      const root = engine.chat().read({ channelId: outcome.approval.channelId }).at(-1)!
      expect(root.text).not.toContain('Approval needed')
      expect(root.text).not.toContain('Reason:')
      expect(root.text).not.toContain('@boss')
      expect(root.mentions).toContain(BOSS)
    }
  })

  it('wakes the others only to read the request thread, as any #general post', () => {
    const { engine, ada, grace, askToStart } = setup()
    engine.approvals.setLevel('supervised')

    const approval = pendingApproval(askToStart())

    expect(engine.inbox.list(grace.id)).toEqual([
      expect.objectContaining({ kind: 'general', fromId: ada.id, messageId: approval.messageId }),
    ])
    expect(engine.inbox.list(ada.id)).toEqual([])
  })

  it('always asks for an action outside the table, even under Autonomous', () => {
    const { engine, ada } = setup()
    engine.approvals.setLevel('autonomous')

    const outcome = engine.approvals.request({ requesterId: ada.id, action: 'other', subject: 'Drop the users table' })

    expect(pendingApproval(outcome)).toMatchObject({ status: 'pending', reason: '' })
  })

  it('asks under Autonomous when a condition says so', () => {
    const { engine, ada } = setup()
    engine.approvals.setLevel('autonomous')

    const outcome = engine.approvals.request({
      requesterId: ada.id,
      action: 'merge',
      ticketId: engine.board().createTicket({ title: 'Login page' }).id,
      conditions: { ciRed: true },
    })

    expect(outcome.gate).toBe('ask')
  })

  it('needs a known Employee and a subject', () => {
    const { engine, ada } = setup()
    engine.approvals.setLevel('supervised')

    expect(() => engine.approvals.request({ requesterId: BOSS, action: 'start', subject: '#1' })).toThrow(
      /unknown employee/i,
    )
    expect(() => engine.approvals.request({ requesterId: 'ghost', action: 'start', subject: '#1' })).toThrow(
      /unknown employee/i,
    )
    expect(() => engine.approvals.request({ requesterId: ada.id, action: 'start', subject: '  ' })).toThrow(/subject/i)
    expect(engine.approvals.list()).toEqual([])
  })

  it('lists pending Approvals on their own', () => {
    const { engine, grace, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const first = pendingApproval(askToStart())
    const second = pendingApproval(askToStart(grace.id))
    engine.approvals.decide(first.id, { approve: true })

    expect(engine.approvals.list({ status: 'pending' })).toEqual([second])
    expect(engine.approvals.list().map((a) => a.id)).toEqual([first.id, second.id])
  })

  it('tells listeners about new Approvals', () => {
    const { engine, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const listener = vi.fn()
    engine.approvals.onChange(listener)

    askToStart()

    expect(listener).toHaveBeenCalled()
  })
})

describe('Approval decisions', () => {
  it('approves: the thread says so and the requester’s inbox gets the decision', () => {
    const { engine, ada, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const approval = pendingApproval(askToStart())

    const decided = engine.approvals.decide(approval.id, { approve: true })

    expect(decided).toMatchObject({ id: approval.id, status: 'approved', decidedAt: expect.any(String) })
    const thread = engine.chat().read({ channelId: approval.channelId, threadId: approval.messageId })
    expect(thread.at(-1)).toMatchObject({ authorId: BOSS, threadId: approval.messageId })
    expect(thread.at(-1)!.text).toMatch(/approved/i)
    expect(engine.inbox.list(ada.id)).toEqual([
      expect.objectContaining({ kind: 'approval', fromId: BOSS, status: 'pending', threadId: approval.messageId }),
    ])
    const [item] = engine.inbox.list(ada.id)
    expect(item!.prompt).toMatch(/approved/i)
    expect(item!.prompt).toContain('#12 Login page')
  })

  it('rejects with the boss’s reason, which reaches the requester', () => {
    const { engine, ada, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const approval = pendingApproval(askToStart())

    const decided = engine.approvals.decide(approval.id, { approve: false, reason: 'Finish #9 first' })

    expect(decided).toMatchObject({ status: 'rejected', decisionReason: 'Finish #9 first' })
    const thread = engine.chat().read({ channelId: approval.channelId, threadId: approval.messageId })
    expect(thread.at(-1)!.text).toMatch(/rejected/i)
    expect(thread.at(-1)!.text).toContain('Finish #9 first')
    const [item] = engine.inbox.list(ada.id)
    expect(item).toMatchObject({ kind: 'approval' })
    expect(item!.prompt).toMatch(/rejected/i)
    expect(item!.prompt).toContain('Finish #9 first')
  })

  it('needs a reason to reject', () => {
    const { engine, ada, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const approval = pendingApproval(askToStart())

    expect(() => engine.approvals.decide(approval.id, { approve: false, reason: ' ' })).toThrow(/reason/i)
    expect(engine.approvals.list()).toEqual([approval])
    expect(engine.inbox.list(ada.id)).toEqual([])
  })

  it('decides an Approval only once', () => {
    const { engine, ada, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const approval = pendingApproval(askToStart())
    engine.approvals.decide(approval.id, { approve: true })

    expect(() => engine.approvals.decide(approval.id, { approve: false, reason: 'no' })).toThrow(/already/i)
    expect(() => engine.approvals.decide(999, { approve: true })).toThrow(/no approval 999/i)
    expect(engine.inbox.list(ada.id)).toHaveLength(1)
  })

  it('pushes the decision to an idle requester', () => {
    const { engine, ada, startIdle, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const session = startIdle(ada.id)
    const approval = pendingApproval(askToStart())

    engine.approvals.decide(approval.id, { approve: false, reason: 'Not now' })

    expect(session.pushed).toEqual([expect.stringContaining('Not now')])
  })

  it('keeps the decision waiting while the requester is busy', () => {
    const { engine, ada, startIdle, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const session = startIdle(ada.id)
    session.hook('UserPromptSubmit')
    const approval = pendingApproval(askToStart())

    engine.approvals.decide(approval.id, { approve: true })
    expect(session.pushed).toEqual([])
    session.hook('Stop')

    expect(session.pushed).toEqual([expect.stringMatching(/approved/i)])
  })

  it('grants an action only once it is free or approved', () => {
    const { engine, ada, grace, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const approval = pendingApproval(askToStart())

    expect(engine.approvals.granted(ada.id, 'start', '#12 Login page')).toBe(false)
    engine.approvals.decide(approval.id, { approve: true })

    expect(engine.approvals.granted(ada.id, 'start', '#12 Login page')).toBe(true)
    expect(engine.approvals.granted(grace.id, 'start', '#12 Login page')).toBe(false)
    expect(engine.approvals.granted(ada.id, 'start', '#13 Signup')).toBe(false)
    engine.approvals.setLevel('managed')
    expect(engine.approvals.granted(grace.id, 'start', '#13 Signup')).toBe(true)
  })

  it('tells decision listeners what was decided', () => {
    const { engine, askToStart } = setup()
    engine.approvals.setLevel('supervised')
    const approval = pendingApproval(askToStart())
    const decided = vi.fn()
    engine.approvals.onDecision(decided)

    engine.approvals.decide(approval.id, { approve: true, reason: 'Go' })

    expect(decided).toHaveBeenCalledWith(
      expect.objectContaining({ id: approval.id, status: 'approved' }),
      engine.currentCompany()!.id,
    )
  })
})

describe('Demo: Supervised, an Employee asks to start work', () => {
  it('asks, waits for the boss, and gets the go-ahead in its next prompt', () => {
    const { engine, ada, startIdle } = setup()
    engine.approvals.setLevel('supervised')
    const session = startIdle(ada.id)

    // Ada is working a turn and asks to start the ticket.
    session.hook('UserPromptSubmit')
    const outcome = engine.approvals.request({ requesterId: ada.id, action: 'start', subject: '#12 Login page' })
    const approval = pendingApproval(outcome)
    session.hook('Stop')
    expect(session.pushed).toEqual([])
    expect(engine.approvals.list({ status: 'pending' })).toEqual([approval])

    // The boss approves from the chat thread.
    engine.approvals.decide(approval.id, { approve: true })

    expect(session.pushed).toEqual([expect.stringMatching(/approved.*start work.*#12 Login page/i)])
    expect(engine.approvals.granted(ada.id, 'start', '#12 Login page')).toBe(true)
  })
})
