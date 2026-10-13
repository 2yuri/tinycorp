import { describe, expect, it } from 'vitest'
import type { Approval } from '../../../shared/approvals'
import type { BoardCommand, BoardSnapshot, Ticket } from '../../../shared/domain/board'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import type { ResumeAll } from '../../../shared/session'
import { approvalInScope, runSlash, type SlashDeps } from './slash-run'

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })
const fails = (error: string) => Promise.resolve({ ok: false as const, error })

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    epicId: null,
    title: 'Login page',
    description: '',
    column: 'todo',
    assigneeId: null,
    repos: [],
    blocked: false,
    blockedReason: '',
    blockedBy: [],
    blocks: [],
    subtasks: [],
    priority: 'normal',
    labels: [],
    baseBranch: null,
    ...overrides,
  }
}

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 7,
    action: 'merge',
    requesterId: 'e-hera',
    subject: '#12 Login page',
    ticketId: 12,
    pullRequest: null,
    reason: 'CI is green',
    status: 'pending',
    decisionReason: null,
    channelId: 'prs',
    messageId: 100,
    createdAt: '',
    decidedAt: null,
    ...overrides,
  }
}

/** Everything the run touched, and a `deps` whose calls all succeed. */
const RESUMED: ResumeAll = { paused: false, resumed: ['ada'], failed: [], from: 'held' }

function harness(overrides: Partial<SlashDeps> = {}, resumeAll: ResumeAll = RESUMED) {
  const posted: { channelId: string; text: string }[] = []
  const applied: BoardCommand[] = []
  const decided: { id: number; approve: boolean; reason: string | undefined }[] = []
  const opened: string[] = []
  const hired: string[] = []
  const sessions: string[] = []
  const snapshot: BoardSnapshot = {
    columns: [],
    targets: [],
    epics: [{ id: 3, targetId: null, title: 'Billing', description: '', color: 'indigo' }],
    tickets: [],
  }
  const deps: SlashDeps = {
    companyKey: 'TC',
    channelId: 'general',
    threadId: null,
    epicId: null,
    approvals: new Map(),
    intakeId: 'e-hera',
    people: [
      { id: 'e-hera', name: 'Hera' },
      { id: 'e-orion', name: 'Orion' },
    ],
    roles: [{ id: 'r-pm', name: 'Product manager' }],
    chat: {
      post: (channelId, text) => {
        posted.push({ channelId, text })
        return ok({ id: 1 }) as never
      },
    },
    board: {
      apply: (command) => {
        applied.push(command)
        const title = command.kind === 'createTicket' ? command.input.title : ''
        return ok({ ...snapshot, tickets: [ticket({ id: 57, title })] })
      },
    },
    sessions: {
      pauseAll: () => {
        sessions.push('pause')
        return ok(true)
      },
      resumeAll: () => {
        sessions.push('resume')
        return ok(resumeAll)
      },
    },
    approvalApi: {
      decide: (id, decision) => {
        decided.push({ id, approve: decision.approve, reason: decision.reason })
        return ok(approval()) as never
      },
    },
    openChannel: (channelId) => opened.push(channelId),
    openHire: (roleId) => hired.push(roleId),
    ...overrides,
  }
  return { deps, posted, applied, decided, opened, hired, sessions }
}

describe('a command that cannot run', () => {
  it('posts nothing and answers with the hint', async () => {
    const h = harness()

    expect(await runSlash('/deploy staging', h.deps)).toEqual({
      ok: false,
      hint: '/deploy is not a command. Type / to see them all.',
    })
    expect(h.posted).toEqual([])
    expect(h.applied).toEqual([])
  })

  it('carries the engine\u2019s own error through, so nothing is invented', async () => {
    const h = harness({ board: { apply: () => fails('Todo is over its WIP limit') } })

    expect(await runSlash('/ticket Login page', h.deps)).toEqual({ ok: false, hint: 'Todo is over its WIP limit' })
  })
})

describe('/dm and /goal', () => {
  it('opens the DM and sends what follows the name', async () => {
    const h = harness()

    expect(await runSlash('/dm Orion can you take #12?', h.deps)).toEqual({ ok: true, note: null })
    expect(h.posted).toEqual([{ channelId: dmChannelId(BOSS, 'e-orion'), text: 'can you take #12?' }])
    expect(h.opened).toEqual([dmChannelId(BOSS, 'e-orion')])
  })

  it('only opens the DM when the name stands alone', async () => {
    const h = harness()

    await runSlash('/dm Orion', h.deps)

    expect(h.posted).toEqual([])
    expect(h.opened).toEqual([dmChannelId(BOSS, 'e-orion')])
  })

  it('sends a goal to whoever holds intake', async () => {
    const h = harness()

    await runSlash('/goal ship the billing rewrite', h.deps)

    expect(h.posted).toEqual([{ channelId: dmChannelId(BOSS, 'e-hera'), text: 'ship the billing rewrite' }])
  })

  it('says so when nobody holds intake, and sends nothing', async () => {
    const h = harness({ intakeId: null })

    const outcome = await runSlash('/goal ship it', h.deps)

    expect(outcome.ok).toBe(false)
    expect(h.posted).toEqual([])
  })
})

describe('/ticket', () => {
  it('creates in Todo with no epic outside an epic channel', async () => {
    const h = harness()

    expect(await runSlash('/ticket Login page', h.deps)).toEqual({ ok: true, note: 'Created TC-57 in Todo.' })
    expect(h.applied).toEqual([{ kind: 'createTicket', input: { title: 'Login page', column: 'todo', epicId: null } }])
  })

  it('scopes it to the epic the channel is about', async () => {
    const h = harness({ channelId: 'epic-3-billing', epicId: 3 })

    expect(await runSlash('/ticket Refund flow', h.deps)).toEqual({
      ok: true,
      note: 'Created TC-57 in Todo, in this epic.',
    })
    expect(h.applied[0]).toEqual({
      kind: 'createTicket',
      input: { title: 'Refund flow', column: 'todo', epicId: 3 },
    })
  })
})

describe('/approve and /reject', () => {
  const waiting = new Map([[100, approval()]])

  it('decides the approval of the thread they were typed in', async () => {
    const h = harness({ channelId: 'prs', threadId: 100, approvals: waiting })

    expect(await runSlash('/approve', h.deps)).toEqual({ ok: true, note: 'Approved: #12 Login page' })
    expect(h.decided).toEqual([{ id: 7, approve: true, reason: undefined }])
  })

  it('sends one back with the reason that was typed', async () => {
    const h = harness({ channelId: 'prs', threadId: 100, approvals: waiting })

    expect(await runSlash('/reject the tests are red', h.deps)).toEqual({
      ok: true,
      note: 'Sent back: #12 Login page',
    })
    expect(h.decided).toEqual([{ id: 7, approve: false, reason: 'the tests are red' }])
  })

  it('decides nothing when the thread is not an approval', async () => {
    const h = harness({ channelId: 'prs', threadId: 42, approvals: waiting })

    expect(await runSlash('/approve', h.deps)).toEqual({
      ok: false,
      hint: 'This thread is not an approval. Open the one you mean.',
    })
    expect(h.decided).toEqual([])
  })
})

describe('which approval is in scope', () => {
  it('is the one this thread is about', () => {
    const scope = approvalInScope(new Map([[100, approval()]]), 'prs', 100)

    expect(scope.ok && scope.approval.id).toBe(7)
  })

  it('refuses one that was already decided, naming what it came to', () => {
    const done = new Map([[100, approval({ status: 'rejected' })]])

    expect(approvalInScope(done, 'prs', 100)).toEqual({ ok: false, hint: 'That one was already sent back.' })
  })

  it('with no thread open, takes the only one waiting in this channel', () => {
    const map = new Map([
      [100, approval()],
      [200, approval({ id: 8, messageId: 200, channelId: 'tech' })],
    ])

    const scope = approvalInScope(map, 'prs', null)

    expect(scope.ok && scope.approval.id).toBe(7)
  })

  it('asks the boss to pick when several wait in the channel', () => {
    const map = new Map([
      [100, approval()],
      [200, approval({ id: 8, messageId: 200 })],
    ])

    expect(approvalInScope(map, 'prs', null)).toEqual({
      ok: false,
      hint: '2 approvals are waiting here. Open one and run the command in its thread.',
    })
  })

  it('says nothing waits where nothing does', () => {
    expect(approvalInScope(new Map(), 'prs', null)).toEqual({
      ok: false,
      hint: 'Nothing is waiting on you in this channel.',
    })
  })
})

describe('/hire, /pause and /resume', () => {
  it('opens the hire flow on the role that was named', async () => {
    const h = harness()

    expect(await runSlash('/hire Product manager', h.deps)).toEqual({ ok: true, note: null })
    expect(h.hired).toEqual(['r-pm'])
  })

  it('stops and starts every Session', async () => {
    const h = harness()

    expect(await runSlash('/pause', h.deps)).toMatchObject({ ok: true })
    expect(await runSlash('/resume', h.deps)).toEqual({ ok: true, note: 'Resuming 1 Session.' })
    expect(h.sessions).toEqual(['pause', 'resume'])
  })

  // T217: the boss typed `/resume` and read `Resumed. The paused Sessions are starting again.`
  // however many Sessions came back, which was none.
  it('says a resume brought nobody back, rather than that it happened', async () => {
    const h = harness({}, { paused: false, resumed: [], failed: [], from: 'nobody' })

    expect(await runSlash('/resume', h.deps)).toEqual({
      ok: true,
      note: expect.stringContaining('Nothing to resume'),
    })
  })

  it('names the Employee a resume could not start', async () => {
    const h = harness(
      {},
      {
        paused: false,
        resumed: ['grace'],
        failed: [{ employeeId: 'ada', name: 'Ada', reason: 'claude is not on this machine' }],
        from: 'held',
      },
    )

    expect(await runSlash('/resume', h.deps)).toEqual({
      ok: true,
      note: 'Resuming 1 Session. Ada could not start: claude is not on this machine.',
    })
  })
})
