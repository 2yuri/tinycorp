import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import { APPROVAL_SUBJECT_MIGRATION } from './approval-subject'
import { APPROVALS_MIGRATION } from './approvals'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

async function setup() {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: fakeGit(),
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: readyStack() })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: readyStack() })

  const board = engine.board()
  const ticket = board.createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id, api.id] })
  board.moveTicket(ticket.id, 'doing')
  board.moveTicket(ticket.id, 'review')
  await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
  const other = board.createTicket({ title: 'Docs', assigneeId: ada.id, repos: [web.id] })
  engine.approvals.setLevel('supervised')

  const pullRequest = (repoId: string) => engine.code.of(ticket.id).pullRequests.find((p) => p.repoId === repoId)!
  const ask = (input: Omit<Parameters<CompanyEngine['approvals']['request']>[0], 'requesterId'>) => {
    const outcome = engine.approvals.request({ requesterId: ada.id, ...input })
    if (outcome.gate !== 'ask') throw new Error('Expected an Approval')
    return outcome.approval
  }
  return { engine, ada, web, api, ticket, other, pullRequest, ask }
}

describe('Approval subjects', () => {
  it('writes the subject of a merge from the ticket it names, whatever the requester wrote', async () => {
    const { engine, ticket, ask } = await setup()

    const approval = ask({ action: 'merge', ticketId: ticket.id, subject: 'PR 7 on api' })

    expect(approval).toMatchObject({ subject: `AC-${ticket.id} Login page`, ticketId: ticket.id, pullRequest: null })
    expect(engine.chat().read({ channelId: 'general' }).at(-1)!.text).toContain(`AC-${ticket.id} Login page`)
  })

  it('finds the ticket of a merge from the PR it names, and keeps the PR', async () => {
    const { engine, api, ticket, pullRequest, ask } = await setup()
    const number = pullRequest(api.id).number!

    const approval = ask({ action: 'merge', pullRequest: { repoId: api.id, number } })

    expect(approval).toMatchObject({
      subject: `AC-${ticket.id} Login page`,
      ticketId: ticket.id,
      pullRequest: { repoId: api.id, number },
    })
    expect(engine.approvals.list()).toEqual([approval])
  })

  it('refuses a merge or PR request that names no ticket, or names one that does not fit', async () => {
    const { engine, ada, api, web, other, pullRequest } = await setup()
    const ask = (input: object) => () => engine.approvals.request({ requesterId: ada.id, action: 'merge', ...input })

    expect(ask({ subject: 'PR 7 on api' })).toThrow(/needs the ticket/i)
    expect(() => engine.approvals.request({ requesterId: ada.id, action: 'open_pr', subject: '#1' })).toThrow(
      /needs the ticket/i,
    )
    expect(ask({ ticketId: 999 })).toThrow(/no ticket AC-999/i)
    expect(ask({ pullRequest: { repoId: web.id, number: 999 } })).toThrow(/no PR 999/i)
    expect(ask({ ticketId: other.id, pullRequest: { repoId: api.id, number: pullRequest(api.id).number } })).toThrow(
      /belongs to AC-/i,
    )
    expect(engine.approvals.list()).toEqual([])
  })

  it('names a ticket for any other action too, and keeps words when none is named', async () => {
    const { other, ask } = await setup()

    expect(ask({ action: 'start', ticketId: other.id })).toMatchObject({
      subject: `AC-${other.id} Docs`,
      ticketId: other.id,
    })
    expect(ask({ action: 'hire', subject: ' a Designer ' })).toMatchObject({ subject: 'a Designer', ticketId: null })
  })

  it('grants by the ticket an approved request named, even after the ticket is renamed', async () => {
    const { engine, ada, ticket, ask } = await setup()
    const approval = ask({ action: 'merge', ticketId: ticket.id })
    engine.approvals.decide(approval.id, { approve: true })
    engine.board().updateTicket(ticket.id, { title: 'Sign-in page' })

    expect(engine.approvals.granted(ada.id, 'merge', { ticketId: ticket.id })).toBe(true)
    expect(engine.approvals.granted(ada.id, 'merge', { ticketId: ticket.id + 1 })).toBe(false)
  })
})

describe('the approvals-ticket-and-pull-request migration', () => {
  it('fills the ticket of older `#<id> …` subjects and leaves the rest without one', () => {
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
    runMigrations(db, [APPROVALS_MIGRATION])
    const insert = db.prepare(
      `INSERT INTO approval (action, requester_id, subject, reason, channel_id, message_id, created_at)
       VALUES ('merge', 'e1', ?, '', 'general', 1, '')`,
    )
    for (const subject of ['#12 Login page', '#7', 'PR 7 on api', 'a Designer']) insert.run(subject)

    runMigrations(db, [APPROVALS_MIGRATION, APPROVAL_SUBJECT_MIGRATION])

    expect(db.prepare('SELECT subject, ticket_id, pr_repo_id, pr_number FROM approval ORDER BY id').all()).toEqual([
      { subject: '#12 Login page', ticket_id: 12, pr_repo_id: null, pr_number: null },
      { subject: '#7', ticket_id: 7, pr_repo_id: null, pr_number: null },
      { subject: 'PR 7 on api', ticket_id: null, pr_repo_id: null, pr_number: null },
      { subject: 'a Designer', ticket_id: null, pr_repo_id: null, pr_number: null },
    ])
  })
})
