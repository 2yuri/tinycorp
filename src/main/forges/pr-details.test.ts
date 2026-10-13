import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../core/testing'
import { fakeGit } from '../platform/testing'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

const node = readyStack()

function setup({ now = () => 0 }: { now?: () => number } = {}) {
  const git = fakeGit()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    recents: inMemoryRecents(),
    isGitRepo: () => true,
    git,
    log: () => {},
    now,
  })
  engines.push(engine)
  engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
  const api = engine.repos.add({ path: onDisk('/code/api'), name: 'api', stack: node })
  async function ticketInReview() {
    const ticket = engine.board().createTicket({ title: 'Login page', assigneeId: ada.id, repos: [web.id, api.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(2))
    return ticket
  }
  return { engine, git, web, api, ticketInReview }
}

describe('PR details', () => {
  it('reads what GitHub says about each of a ticket’s PRs, from the PR’s repo', async () => {
    const { engine, git, web, api, ticketInReview } = setup()
    const ticket = await ticketInReview()
    const [webPr, apiPr] = engine.code.of(ticket.id).pullRequests
    git.setDetails(webPr!.url, {
      additions: 142,
      deletions: 38,
      changedFiles: 6,
      mergeable: 'mergeable',
      checks: [{ name: 'build', workflow: 'CI', state: 'passing', durationMs: 28_000 }],
    })

    const details = await engine.code.details(ticket.id)

    expect(details).toEqual([
      expect.objectContaining({
        ticketId: ticket.id,
        repoId: web.id,
        url: webPr!.url,
        number: webPr!.number,
        additions: 142,
        deletions: 38,
        changedFiles: 6,
        mergeable: 'mergeable',
        checks: [{ name: 'build', workflow: 'CI', state: 'passing', durationMs: 28_000 }],
      }),
      expect.objectContaining({ repoId: api.id, url: apiPr!.url, additions: 0, mergeable: 'unknown' }),
    ])
    expect(git.detailsRead).toEqual([
      { repoPath: onDisk('/code/web'), url: webPr!.url },
      { repoPath: onDisk('/code/api'), url: apiPr!.url },
    ])
  })

  it('is empty for a ticket without PRs', async () => {
    const { engine } = setup()
    const ticket = engine.board().createTicket({ title: 'Idea' })

    expect(await engine.code.details(ticket.id)).toEqual([])
  })

  it('asks GitHub again only after the cache expires', async () => {
    let clock = 0
    const { engine, git, ticketInReview } = setup({ now: () => clock })
    const ticket = await ticketInReview()
    const [webPr] = engine.code.of(ticket.id).pullRequests

    await engine.code.details(ticket.id)
    git.setDetails(webPr!.url, { additions: 5 })
    clock += 10_000
    expect((await engine.code.details(ticket.id))[0]!.additions).toBe(0)
    expect(git.detailsRead).toHaveLength(2)

    clock += 30_000
    expect((await engine.code.details(ticket.id))[0]!.additions).toBe(5)
    expect(git.detailsRead).toHaveLength(4)
  })

  it('leaves out a PR GitHub cannot read, and logs why', async () => {
    const log = vi.fn()
    const git = fakeGit()
    const engine = createCompanyEngine({
      openDatabase: inMemoryDatabases(),
      recents: inMemoryRecents(),
      isGitRepo: () => true,
      git,
      log,
    })
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
    const web = engine.repos.add({ path: onDisk('/code/web'), name: 'web', stack: node })
    const ticket = engine.board().createTicket({ title: 'Login', assigneeId: ada.id, repos: [web.id] })
    engine.board().moveTicket(ticket.id, 'doing')
    engine.board().moveTicket(ticket.id, 'review')
    await vi.waitFor(() => expect(engine.code.of(ticket.id).pullRequests).toHaveLength(1))
    const [pr] = engine.code.of(ticket.id).pullRequests
    git.failDetails(pr!.url, 'HTTP 401: Bad credentials')

    expect(await engine.code.details(ticket.id)).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Bad credentials'))
  })

  it('is empty without a git service', async () => {
    const engine = createCompanyEngine({ openDatabase: inMemoryDatabases(), recents: inMemoryRecents() })
    engines.push(engine)
    engine.createCompany({ folder: onDisk('/work/acme') })
    const ticket = engine.board().createTicket({ title: 'Idea' })

    expect(await engine.code.details(ticket.id)).toEqual([])
  })
})
