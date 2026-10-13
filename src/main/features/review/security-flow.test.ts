import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

/** A patch that touches the preload, which is one of the risky classes. */
const RISKY_PATCH = `diff --git a/src/preload/index.ts b/src/preload/index.ts
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -18,2 +18,2 @@ export const api = {
-  run: (cmd: string) => ipcRenderer.invoke('safe', cmd),
+  run: (cmd: string) => ipcRenderer.invoke('shell:exec', cmd),
`

/** A patch that touches nothing anybody reads twice. */
const PLAIN_PATCH = `diff --git a/src/format/currency.ts b/src/format/currency.ts
--- a/src/format/currency.ts
+++ b/src/format/currency.ts
@@ -18,2 +18,2 @@ export function formatPrice(
-  return cents
+  return cents / 100
`

function setup({ security = true }: { security?: boolean } = {}) {
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
  const rev = engine.employees.create({ name: 'Rev', roleId: 'backend', capabilities: ['review'] })
  const vega = security ? engine.employees.create({ name: 'Vega', roleId: 'security' }) : null
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })

  function callerFor(employeeId: string) {
    if (engine.sessions.get(employeeId).status === 'off') engine.sessions.start(employeeId)
    const caller = engine.mcpCaller(acme.id, provider.spawnOf(employeeId).mcp!.token)
    if (!caller) throw new Error('No MCP caller')
    return caller
  }

  const board = () => engine.board()
  const prs = () => engine.chat().read({ channelId: 'prs' })
  /** The round's own thread in `#prs`, where the merge says what it is waiting for. */
  const roundThread = (ticketId: number) =>
    engine.chat().read({ channelId: 'prs', threadId: engine.reviews.of(ticketId)!.messageId })

  /** A ticket of Ada's in Review, with its PR open and `patch` behind it. */
  async function inReview(patch: string, labels: string[] = []) {
    const ticket = board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id], labels })
    board().moveTicket(ticket.id, 'doing')
    board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    git.setDiff(engine.code.of(ticket.id).pullRequests[0]!.url, patch)
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)).not.toBeNull())
    return ticket
  }

  return { engine, git, ada, rev, vega, board, prs, roundThread, callerFor, inReview }
}

/**
 * The PR is opened and the round starts before the fake is told what the patch is, so the first
 * round of a ticket reads an empty diff. Sending it back and handing it in again gives the round
 * that reads the patch — which is also the shape the app really has: a diff exists once the branch
 * is pushed.
 */
async function secondRound({ engine, callerFor, ada, rev }: ReturnType<typeof setup>, ticketId: number): Promise<void> {
  callerFor(rev!.id).reviews.submit({ ticketId, verdict: 'request_changes', comments: 'Push it first.' })
  callerFor(ada.id).board.moveTicket(ticketId, 'review')
  await vi.waitFor(() => expect(engine.reviews.of(ticketId)?.status).toBe('pending'))
}

describe('When a security pass is asked for', () => {
  it('asks the Security Employee to read a change that touches a risky path, and says why', async () => {
    const parts = setup()
    const { engine, vega, roundThread, inReview } = parts
    const ticket = await inReview(RISKY_PATCH)

    await secondRound(parts, ticket.id)

    await vi.waitFor(() => expect(engine.security.of(ticket.id)).not.toBeNull())
    expect(engine.security.of(ticket.id)).toMatchObject({
      ticketId: ticket.id,
      reviewerId: vega!.id,
      state: 'pending',
      reason: { kind: 'risky', classes: ['ipc'] },
    })
    expect(roundThread(ticket.id).at(-1)!.text).toMatch(
      /Security pass requested from Vega: it touches IPC and the window policy/,
    )
    const item = engine.inbox.list(vega!.id).at(-1)!
    expect(item).toMatchObject({ kind: 'review', ticketId: ticket.id })
    expect(item.prompt).toContain('security_finding')
    expect(item.prompt).toMatch(/read-only/i)
  })

  it('asks for none on an ordinary change under the default scope', async () => {
    const parts = setup()
    const { engine, inReview } = parts
    const ticket = await inReview(PLAIN_PATCH)

    await secondRound(parts, ticket.id)

    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.rounds).toBe(2))
    expect(engine.security.of(ticket.id)).toBeNull()
  })

  it('asks on an ordinary change once the Company says every PR', async () => {
    const parts = setup()
    const { engine, inReview } = parts
    engine.security.setScope('every')
    const ticket = await inReview(PLAIN_PATCH)

    await secondRound(parts, ticket.id)

    await vi.waitFor(() => expect(engine.security.of(ticket.id)).not.toBeNull())
    expect(engine.security.of(ticket.id)).toMatchObject({ reason: { kind: 'every', classes: [] } })
  })

  it('asks on any change of a ticket the boss labelled for it', async () => {
    const parts = setup()
    const { engine, inReview } = parts
    const ticket = await inReview(PLAIN_PATCH, ['security'])

    await secondRound(parts, ticket.id)

    await vi.waitFor(() => expect(engine.security.of(ticket.id)).not.toBeNull())
    expect(engine.security.of(ticket.id)).toMatchObject({ reason: { kind: 'label' } })
  })

  it('asks for none at all in a Company that hired nobody into Security', async () => {
    const parts = setup({ security: false })
    const { engine, inReview } = parts
    const ticket = await inReview(RISKY_PATCH)

    await secondRound(parts, ticket.id)

    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.rounds).toBe(2))
    expect(engine.security.of(ticket.id)).toBeNull()
    expect(engine.security.list()).toEqual([])
  })
})

describe('What a finding does to the merge', () => {
  /** A ticket whose security pass is under way, with the round approved by its reviewer. */
  async function reading() {
    const parts = setup()
    const ticket = await parts.inReview(RISKY_PATCH)
    await secondRound(parts, ticket.id)
    await vi.waitFor(() => expect(parts.engine.security.of(ticket.id)).not.toBeNull())
    return { ...parts, ticket }
  }

  it('holds the merge while the pass is still being read', async () => {
    const { engine, git, rev, ticket, callerFor, roundThread } = await reading()

    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    await vi.waitFor(() =>
      expect(roundThread(ticket.id).some((m) => /security pass on .* is not finished/i.test(m.text))).toBe(true),
    )
    expect(engine.approvals.list({ status: 'pending' })).toEqual([])
    expect(git.merges).toEqual([])
  })

  it('holds it on a high finding, and says where it is', async () => {
    const { engine, git, rev, vega, ticket, callerFor, roundThread } = await reading()
    callerFor(vega!.id).security.file({
      ticketId: ticket.id,
      severity: 'high',
      title: 'The renderer can run any shell command',
      fix: 'Take a command id, not a string, and look it up in a table in the main process.',
      file: 'src/preload/index.ts',
      line: 20,
    })
    callerFor(vega!.id).security.submit({ ticketId: ticket.id, summary: 'One high on the preload.' })

    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    await vi.waitFor(() =>
      expect(roundThread(ticket.id).some((m) => /1 high security finding is open/i.test(m.text))).toBe(true),
    )
    expect(roundThread(ticket.id).at(-1)!.text).toContain('src/preload/index.ts:20')
    expect(engine.approvals.list({ status: 'pending' })).toEqual([])
    expect(git.merges).toEqual([])
    expect(engine.security.of(ticket.id)).toMatchObject({ state: 'findings' })
  })

  it('does not hold it on a medium one', async () => {
    const { engine, rev, vega, ticket, callerFor } = await reading()
    callerFor(vega!.id).security.file({
      ticketId: ticket.id,
      severity: 'medium',
      title: 'The error message carries the command',
      fix: 'Log the command id and not the string.',
      file: 'src/preload/index.ts',
      line: 20,
    })
    callerFor(vega!.id).security.submit({ ticketId: ticket.id, summary: 'Nothing exploitable.' })

    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })

    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
  })

  it('lets the merge go the moment the high finding is settled', async () => {
    const { engine, rev, vega, ticket, callerFor } = await reading()
    const finding = callerFor(vega!.id).security.file({
      ticketId: ticket.id,
      severity: 'high',
      title: 'The renderer can run any shell command',
      fix: 'Take a command id, not a string.',
      file: 'src/preload/index.ts',
      line: 20,
    })
    callerFor(vega!.id).security.submit({ ticketId: ticket.id, summary: 'One high on the preload.' })
    callerFor(rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })
    await vi.waitFor(() => expect(engine.reviews.of(ticket.id)?.status).toBe('approved'))
    expect(engine.approvals.list({ status: 'pending' })).toEqual([])

    callerFor(vega!.id).security.resolve(finding.id)

    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(engine.approvals.list()[0]).toMatchObject({ action: 'merge', ticketId: ticket.id })
  })

  it('files a finding as a review comment carrying the severity and the fix', async () => {
    const { engine, vega, ticket, callerFor } = await reading()

    const finding = callerFor(vega!.id).security.file({
      ticketId: ticket.id,
      severity: 'high',
      title: 'The renderer can run any shell command',
      fix: 'Take a command id, not a string.',
      file: 'src/preload/index.ts',
      line: 20,
    })

    const thread = engine.reviews.threads(ticket.id).find((entry) => entry.id === finding.threadId)!
    expect(thread).toMatchObject({ path: 'src/preload/index.ts', line: 20, state: 'non_blocking' })
    expect(thread.messages[0]!.body).toContain('Security · high')
    expect(thread.messages[0]!.body).toContain('**Fix:** Take a command id, not a string.')
  })

  it('refuses a finding with no fix in it, and one on somebody else’s pass', async () => {
    const { rev, vega, ticket, callerFor } = await reading()

    expect(() =>
      callerFor(vega!.id).security.file({ ticketId: ticket.id, severity: 'high', title: 'Bad', fix: '  ' }),
    ).toThrow(/concrete fix/i)
    expect(() =>
      callerFor(rev!.id).security.file({ ticketId: ticket.id, severity: 'high', title: 'Bad', fix: 'Good' }),
    ).toThrow(/not yours/i)
  })
})

describe('The boss’s override', () => {
  async function blocked() {
    const parts = setup()
    const ticket = await parts.inReview(RISKY_PATCH)
    await secondRound(parts, ticket.id)
    await vi.waitFor(() => expect(parts.engine.security.of(ticket.id)).not.toBeNull())
    parts.callerFor(parts.vega!.id).security.file({
      ticketId: ticket.id,
      severity: 'high',
      title: 'The renderer can run any shell command',
      fix: 'Take a command id, not a string.',
      file: 'src/preload/index.ts',
      line: 20,
    })
    parts.callerFor(parts.vega!.id).security.submit({ ticketId: ticket.id, summary: 'One high on the preload.' })
    parts.callerFor(parts.rev!.id).reviews.submit({ ticketId: ticket.id, verdict: 'approve', comments: 'LGTM' })
    await vi.waitFor(() => expect(parts.engine.reviews.of(ticket.id)?.status).toBe('approved'))
    return { ...parts, ticket }
  }

  it('lets the held merge through, with the reason on the record and in #prs', async () => {
    const { engine, ticket, prs } = await blocked()
    expect(engine.approvals.list({ status: 'pending' })).toEqual([])

    const pass = engine.security.override(ticket.id, 'The command table lands in the next ticket; this is internal.')

    expect(pass).toMatchObject({
      state: 'overridden',
      overriddenBy: BOSS,
      overrideReason: 'The command table lands in the next ticket; this is internal.',
    })
    expect(prs().at(-1)!.text).toMatch(/overrode the security pass/i)
    expect(prs().at(-1)!.text).toContain('1 high still open')
    await vi.waitFor(() => expect(engine.approvals.list({ status: 'pending' })).toHaveLength(1))
  })

  it('refuses an override with no reason, and a second one', async () => {
    const { engine, ticket } = await blocked()

    expect(() => engine.security.override(ticket.id, '   ')).toThrow(/reason/i)
    engine.security.override(ticket.id, 'Accepted for now.')
    expect(() => engine.security.override(ticket.id, 'Again')).toThrow(/already overridden/i)
  })
})

describe('The Security role', () => {
  it('is in the catalogue, reviews and codes, and is what routes a pass', () => {
    const { engine, vega } = setup()

    const role = engine.roles.list().find((entry) => entry.id === 'security')!
    expect(role).toMatchObject({ name: 'Security', capabilities: ['review', 'code'], seeded: true })
    expect(role.persona).toMatch(/threat model/i)
    expect(role.persona).toMatch(/nodeIntegration/)
    expect(vega!.capabilities).toEqual(['review', 'code'])
  })
})
