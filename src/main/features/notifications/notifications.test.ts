import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { CompanyNotification } from '../../../shared/notifications'
import { clockTime } from '../../../shared/platform/clock-time'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'
import { budgetBody, initials, pullRequestBody, TEST_NOTIFICATION } from './notifications'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  vi.useRealTimers()
})

/** Lets notifications that wait for the rest of the current action come out. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function setup() {
  const provider = fakeProvider()
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git,
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'backend' })
  const sent: CompanyNotification[] = []
  engine.notifications.onNotify((notification) => void sent.push(notification))
  return { engine, provider, git, acme, ada, grace, sent }
}

describe('Notifications', () => {
  // TI-6: the planner posted the plan, and the boss heard nothing — the message was a mention and
  // rang, at best, as chatter. A plan waiting on them is a decision, and says so (T233).
  it('tells the boss when a plan is ready to approve, and clicking opens its thread', async () => {
    const { engine, acme, sent } = setup()
    const nova = engine.employees.create({ name: 'Nova', roleId: 'pm' })
    const ticket = engine.board().createTicket({ title: 'Usage chart' })
    const subject = { kind: 'ticket', id: ticket.id } as const

    sent.length = 0
    engine.planning.as(nova.id).draft(subject, { goal: 'Customers see what they used.' })
    await settle()

    const plan = engine.planning.of(subject)!
    expect(plan.status).toBe('waiting')
    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'plan',
        title: 'Plan ready to approve',
        body: `Nova — ${engine.chat().read({ channelId: plan.channelId }).at(-1)!.text}`,
        icon: 'NV',
        focus: { kind: 'thread', channelId: plan.channelId, threadId: plan.threadId, messageId: expect.any(Number) },
      },
    ])
  })

  it('tells the boss when an approval is requested, and clicking opens its thread', async () => {
    const { engine, acme, ada, sent } = setup()

    const outcome = engine.approvals.request({
      requesterId: ada.id,
      action: 'hire',
      subject: 'A second frontend engineer',
    })
    await settle()

    if (outcome.gate !== 'ask') throw new Error('hire should ask under Managed')
    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'approval',
        title: 'Approval requested',
        // No Company subtitle: macOS would draw it as a second bold line (audit section 14).
        body: 'Ada wants to hire A second frontend engineer',
        icon: 'AD',
        focus: {
          kind: 'thread',
          channelId: 'general',
          threadId: outcome.approval.messageId,
          messageId: expect.any(Number),
        },
        actions: [
          { id: 'reject', label: 'Reject' },
          { id: 'approve', label: 'Approve' },
        ],
        approvalId: outcome.approval.id,
      },
    ])
  })

  it('carries no Company subtitle, and the requester’s initials as the icon', async () => {
    const { engine, ada, sent } = setup()

    engine.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'a Designer' })
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss which database?' })
    await settle()

    expect(sent).toHaveLength(2)
    for (const notification of sent) {
      expect(notification).not.toHaveProperty('subtitle')
      expect(Object.keys(notification)).not.toContain('subtitle')
      expect(notification.icon).toBe('AD')
    }
  })

  it('says nothing when the action is free under the current level', async () => {
    const { engine, ada, sent } = setup()

    engine.approvals.request({ requesterId: ada.id, action: 'ticket_create', subject: 'Login page' })
    await settle()

    expect(sent).toEqual([])
  })

  it('tells the boss when an Employee mentions them, and clicking opens the conversation', async () => {
    const { engine, acme, ada, grace, sent } = setup()
    const root = engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss which database?' })
    const reply = engine.chat().reply({ authorId: grace.id, messageId: root.id, text: 'Ask @Boss, not me' })
    await settle()

    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'mention',
        title: 'Ada mentioned you',
        body: '#tech — “@boss which database?”',
        icon: 'AD',
        focus: { kind: 'thread', channelId: 'tech', threadId: null, messageId: expect.any(Number) },
      },
      {
        companyId: acme.id,
        kind: 'mention',
        title: 'Grace mentioned you',
        body: '#tech — “Ask @Boss, not me”',
        icon: 'GR',
        focus: { kind: 'thread', channelId: 'tech', threadId: reply.threadId, messageId: expect.any(Number) },
      },
    ])
  })

  it('treats a DM to the boss as a mention', async () => {
    const { engine, ada, sent } = setup()
    const dm = dmChannelId(BOSS, ada.id)

    engine.chat().post({ authorId: ada.id, channelId: dm, text: 'Got a minute?' })
    await settle()

    expect(sent).toEqual([
      expect.objectContaining({
        kind: 'mention',
        title: 'Ada sent you a message',
        body: '“Got a minute?”',
        focus: { kind: 'thread', channelId: dm, threadId: null, messageId: expect.any(Number) },
      }),
    ])
  })

  it('stays quiet for the boss’s own messages and for messages that do not mention them', async () => {
    const { engine, ada, grace, sent } = setup()

    engine.chat().post({ authorId: BOSS, channelId: 'general', text: '@boss note to self' })
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@Grace can you review?' })
    engine.chat().post({ authorId: grace.id, channelId: dmChannelId(ada.id, grace.id), text: 'sure' })
    await settle()

    expect(sent).toEqual([])
  })

  it('tells the boss about a Company that is open but not shown', async () => {
    const { engine, provider, acme, ada, sent } = setup()
    engine.sessions.start(ada.id)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(ada.id).mcp!.token)!
    engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })

    caller.chat.post({ authorId: ada.id, channelId: 'general', text: '@boss done with the login page' })
    await settle()

    expect(sent).toEqual([expect.objectContaining({ companyId: acme.id, title: 'Ada mentioned you' })])
  })

  it('tells the boss when someone replies in a thread they started', async () => {
    const { engine, acme, ada, sent } = setup()
    const root = engine.chat().post({ authorId: BOSS, channelId: 'tech', text: 'How is the login page?' })

    engine.chat().reply({ authorId: ada.id, messageId: root.id, text: 'Nearly there' })
    await settle()

    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'mention',
        title: 'Ada replied in your thread',
        body: '#tech — “Nearly there”',
        icon: 'AD',
        focus: { kind: 'thread', channelId: 'tech', threadId: root.id, messageId: expect.any(Number) },
      },
    ])
  })

  it('tells the boss when someone replies in a thread they were mentioned in', async () => {
    const { engine, acme, ada, grace, sent } = setup()
    const root = engine.chat().post({ authorId: ada.id, channelId: 'tech', text: 'Which database, @boss?' })
    await settle()
    sent.length = 0

    engine.chat().reply({ authorId: grace.id, messageId: root.id, text: 'Postgres, surely' })
    await settle()

    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'mention',
        title: 'Grace replied in a thread you’re in',
        body: '#tech — “Postgres, surely”',
        icon: 'GR',
        focus: { kind: 'thread', channelId: 'tech', threadId: root.id, messageId: expect.any(Number) },
      },
    ])
  })

  it('tells the boss when someone replies after they were mentioned in a reply', async () => {
    const { engine, ada, grace, sent } = setup()
    const root = engine.chat().post({ authorId: ada.id, channelId: 'tech', text: 'Standup notes' })
    engine.chat().reply({ authorId: ada.id, messageId: root.id, text: '@boss can you look?' })
    await settle()
    sent.length = 0

    engine.chat().reply({ authorId: grace.id, messageId: root.id, text: 'I can take it' })
    await settle()

    expect(sent).toEqual([expect.objectContaining({ title: 'Grace replied in a thread you’re in' })])
  })

  it('rings once for a reply that both names the boss and is in their thread', async () => {
    const { engine, ada, sent } = setup()
    const root = engine.chat().post({ authorId: BOSS, channelId: 'tech', text: 'How is the login page?' })

    engine.chat().reply({ authorId: ada.id, messageId: root.id, text: 'Done, @boss' })
    await settle()

    expect(sent).toEqual([expect.objectContaining({ title: 'Ada mentioned you' })])
  })

  it('stays quiet for the boss’s own reply, and for a thread they are not in', async () => {
    const { engine, ada, grace, sent } = setup()
    const theirs = engine.chat().post({ authorId: BOSS, channelId: 'tech', text: 'How is the login page?' })
    const others = engine.chat().post({ authorId: ada.id, channelId: 'tech', text: 'Shall we rename the repo?' })

    engine.chat().reply({ authorId: BOSS, messageId: theirs.id, text: 'thanks' })
    engine.chat().reply({ authorId: grace.id, messageId: others.id, text: 'yes' })
    await settle()

    expect(sent).toEqual([])
  })

  it('shortens a long message', async () => {
    const { engine, ada, sent } = setup()

    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: `@boss ${'x'.repeat(500)}` })
    await settle()

    expect(sent[0]!.body.length).toBeLessThanOrEqual(200)
    expect(sent[0]!.body.endsWith('…')).toBe(true)
  })
})

describe('PR opened', () => {
  const stack = readyStack()

  it('tells the boss when a PR opens, and clicking opens the assignee', async () => {
    const { engine, acme, ada, sent } = setup()
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack })
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')

    engine.board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'pull_request',
        title: 'Pull request opened',
        body: 'Ada opened web #1 · Login page',
        icon: 'AD',
        focus: { kind: 'employee', employeeId: ada.id },
      },
    ])
  })

  it('opens #prs when the ticket has no assignee any more', async () => {
    const { engine, ada, sent } = setup()
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack })
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().updateTicket(ticket.id, { assigneeId: null })

    engine.board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]!.focus).toEqual({ kind: 'thread', channelId: 'prs', threadId: null, messageId: expect.any(Number) })
    expect(sent[0]).toMatchObject({ body: 'The team opened web #1 · Login page', icon: 'AC' })
  })

  it('says nothing when a PR fails to open', async () => {
    const { engine, git, ada, sent } = setup()
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack })
    git.failPullRequest(onDisk('/work/acme'), 'gh is not logged in')
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')

    engine.board().moveTicket(ticket.id, 'review')

    await vi.waitFor(() => expect(engine.chat().read({ channelId: 'prs' }).at(-1)?.text).toMatch(/Could not open a PR/))
    await settle()
    expect(sent).toEqual([])
  })
})

describe('Budget exhausted', () => {
  const LIMIT_OUTPUT = 'Claude usage limit reached. Your limit will reset at 3pm (UTC)'

  function running() {
    vi.useFakeTimers({
      now: new Date('2026-09-17T12:00:00.000Z'),
      toFake: ['setTimeout', 'clearTimeout', 'Date'],
    })
    const context = setup()
    const sessions = [context.ada, context.grace].map((employee) => {
      context.engine.sessions.start(employee.id)
      const session = context.provider.spawnOf(employee.id)
      session.hook('SessionStart')
      return session
    })
    vi.advanceTimersByTime(READY_DELAY_MS)
    return { ...context, sessions }
  }

  it('tells the boss once when the budget runs out, and clicking opens #general', async () => {
    const { engine, acme, sessions, sent } = running()

    sessions[0]!.pty.output(LIMIT_OUTPUT)
    sessions[1]!.pty.output(LIMIT_OUTPUT)
    await settle()

    const said = engine.chat().read({ channelId: 'general' }).at(-1)!
    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'budget',
        title: 'Budget exhausted',
        body: `The subscription limit is reached. The team is in the coffee area until ${clockTime(new Date('2026-09-17T15:00:00.000Z'), new Date())}.`,
        icon: '!',
        focus: { kind: 'thread', channelId: 'general', threadId: null, messageId: expect.any(Number) },
      },
    ])
    expect(said.text).toMatch(/usage limit/)
  })
})

describe('Notification wording', () => {
  it('says when the team is back, or that the reset time is unknown', () => {
    const now = new Date(2026, 8, 17, 11, 48)

    expect(budgetBody(new Date(2026, 8, 17, 14, 0), now)).toBe(
      'The subscription limit is reached. The team is in the coffee area until 14:00.',
    )
    expect(budgetBody(null, now)).toBe(
      'The subscription limit is reached. The team is in the coffee area until the limit resets.',
    )
  })

  it('names a PR without a number by its repo', () => {
    expect(pullRequestBody({ opener: 'Ada', repo: 'web', number: null, title: 'Login page' })).toBe(
      'Ada opened a PR in web · Login page',
    )
  })

  it('draws initials like the design', () => {
    expect(initials('Orion')).toBe('OR')
    expect(initials('Nova')).toBe('NV')
    expect(initials('Vega')).toBe('VG')
    expect(initials('Tiny Corp')).toBe('TC')
    expect(initials('Aia')).toBe('AI')
    expect(initials('  ')).toBe('?')
  })
})

describe('Per-Company toggle', () => {
  it('is on by default and silences only the Company that turns it off', async () => {
    const { engine, acme, ada, sent } = setup()
    const globex = engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
    const juno = engine.employees.create({ name: 'Juno', roleId: 'backend' })

    expect(engine.notifications.enabled()).toBe(true)
    expect(engine.notifications.setEnabled(false)).toBe(false)
    expect(engine.notifications.enabled()).toBe(false)
    engine.chat().post({ authorId: juno.id, channelId: 'tech', text: '@boss hello from Globex' })
    engine.switchCompany(acme.id)
    expect(engine.notifications.enabled()).toBe(true)
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss hello from Acme' })
    engine.approvals.request({ requesterId: ada.id, action: 'fire', subject: 'Grace' })
    await settle()

    expect(sent.map((n) => [n.companyId, n.kind])).toEqual([
      [acme.id, 'mention'],
      [acme.id, 'approval'],
    ])
    engine.switchCompany(globex.id)
    expect(engine.notifications.enabled()).toBe(false)
  })

  it('turns back on', async () => {
    const { engine, ada, sent } = setup()

    engine.notifications.setEnabled(false)
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss one' })
    await settle()
    engine.notifications.setEnabled(true)
    engine.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss two' })
    await settle()

    expect(sent.map((n) => n.body)).toEqual(['#tech — “@boss two”'])
  })

  it('sends the test banner down the path a real notification takes, and answers with what the system did', async () => {
    const { engine, acme, sent } = setup()
    engine.notifications.onNotify(() => ({ status: 'accepted' }) as const)

    const delivery = await engine.notifications.sendTest()

    expect(sent).toEqual([
      {
        companyId: acme.id,
        kind: 'test',
        title: TEST_NOTIFICATION.title,
        body: TEST_NOTIFICATION.body,
        icon: 'AC',
        focus: { kind: 'thread', channelId: 'general', threadId: null },
      },
    ])
    expect(delivery).toEqual({ status: 'accepted' })
  })

  it('answers a refusal with the refusal, not with silence', async () => {
    const { engine } = setup()
    engine.notifications.onNotify(() => Promise.resolve({ status: 'refused', reason: 'Not authorized' } as const))

    expect(await engine.notifications.sendTest()).toEqual({ status: 'refused', reason: 'Not authorized' })
  })

  it('answers that nothing can post a banner when no listener says otherwise', async () => {
    const { engine } = setup()

    expect(await engine.notifications.sendTest()).toEqual({ status: 'unsupported' })
  })

  it('sends no test while the Company has notifications off, and says so', async () => {
    const { engine, sent } = setup()
    engine.notifications.onNotify(() => ({ status: 'accepted' }) as const)
    engine.notifications.setEnabled(false)

    expect(await engine.notifications.sendTest()).toEqual({ status: 'off' })
    expect(sent).toEqual([])
  })

  it('needs an open Company to test', () => {
    const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
    engines.push(engine)

    expect(() => engine.notifications.sendTest()).toThrow(/no company is open/i)
  })

  it('keeps the setting when the Company is opened again', () => {
    const folder = mkdtempSync(join(tmpdir(), 'tinycorp-'))
    try {
      const first = createCompanyEngine({ recents: inMemoryRecents() })
      first.createCompany({ folder })
      first.notifications.setEnabled(false)
      first.close()

      const second = createCompanyEngine({ recents: inMemoryRecents() })
      second.openCompany(folder)
      const enabled = second.notifications.enabled()
      second.close()

      expect(enabled).toBe(false)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('rejects anything but on or off, and needs an open Company', () => {
    const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
    engines.push(engine)

    expect(() => engine.notifications.enabled()).toThrow(/no company is open/i)
    engine.createCompany({ folder: onDisk('/work/acme') })
    expect(() => engine.notifications.setEnabled('yes' as unknown as boolean)).toThrow(/on or off/)
  })
})
