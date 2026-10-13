import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryDatabases, inMemoryRecents, onDisk, readyStack } from '../../core/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'
import { inMemoryPageFiles, type MemoryPageFiles } from './company-memory-files'

const engines: CompanyEngine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
})

/** A Company whose memory folder lives in this process, so no test writes a wiki to the disk. */
function setup(extra: Partial<Parameters<typeof createCompanyEngine>[0]> = {}) {
  const pages: MemoryPageFiles = inMemoryPageFiles()
  const engine = createCompanyEngine({
    openDatabase: inMemoryDatabases(),
    isGitRepo: () => true,
    memoryPages: () => pages,
    log: () => {},
    recents: inMemoryRecents(),
    ...extra,
  })
  engines.push(engine)
  return { engine, pages }
}

const DRAFT = {
  goal: 'Money is formatted once, at the edge. The account decides the locale, never the browser.',
  approach: 'billing-api returns integers plus a currency code; web-app formats them.',
  acceptanceCriteria: ['An invoice reads the same for everyone who opens it.'],
  risks: ['The 90d chart still formats on its own.'],
}

describe('a ticket reaching Done writes the Company memory', () => {
  function company() {
    const { engine, pages } = setup()
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const nova = engine.employees.create({ name: 'Nova', roleId: 'pm' })
    const vega = engine.employees.create({ name: 'Vega', roleId: 'backend' })
    engine.repos.add({ path: onDisk('/code/billing-api'), name: 'billing-api', stack: readyStack() })
    return { engine, pages, nova, vega }
  }

  it('turns the approved plan into a Decision, with one Activity line and no model', () => {
    const { engine, pages, nova } = company()
    const ticket = engine.board().createTicket({ title: 'Invoice totals disagree for a German account' })
    engine.planning.as(nova.id).draft({ kind: 'ticket', id: ticket.id }, DRAFT)
    engine.planning.approve(engine.planning.of({ kind: 'ticket', id: ticket.id })!.id)

    engine.board().moveTicket(ticket.id, 'done')

    const written = engine.companyMemory.list()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      kind: 'decision',
      title: 'Money is formatted once, at the edge',
      sources: [{ kind: 'ticket', ref: 'AC-1' }],
    })
    expect(engine.companyMemory.get(written[0]!.slug)?.body).toContain(
      'billing-api returns integers plus a currency code',
    )
    // The file is what it says it is, and the index is only a view over it.
    expect(pages.read('decisions/money-is-formatted-once-at-the-edge.md')).toContain('kind: decision')

    const captured = engine.activity.list().filter((event) => event.kind === 'memory_captured')
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      summary: '1 page updated from AC-1',
      detail: 'from the plan · Money is formatted once, at the edge',
      badge: { label: 'No model', tone: 'neutral' },
      subject: { kind: 'memory', id: 'AC-1', label: 'AC-1' },
    })
  })

  it('writes one line and one set of pages however often the ticket is moved to Done', () => {
    const { engine, nova } = company()
    const ticket = engine.board().createTicket({ title: 'Invoice totals disagree' })
    engine.planning.as(nova.id).draft({ kind: 'ticket', id: ticket.id }, DRAFT)
    engine.planning.approve(engine.planning.of({ kind: 'ticket', id: ticket.id })!.id)

    engine.board().moveTicket(ticket.id, 'done')
    engine.board().moveTicket(ticket.id, 'review')
    engine.board().moveTicket(ticket.id, 'done')

    expect(engine.companyMemory.counts().pages).toBe(1)
    expect(engine.companyMemory.fromTicket('AC-1')).toHaveLength(1)
    // Two closes is two lines; what it must not do is write the page twice over.
    expect(engine.activity.list().filter((event) => event.kind === 'memory_captured')).toHaveLength(2)
  })

  it('writes nothing, and no line, for a ticket that was worked without a plan', () => {
    const { engine } = company()
    const ticket = engine.board().createTicket({ title: 'A small fix' })
    engine.board().moveTicket(ticket.id, 'done')

    expect(engine.companyMemory.list()).toEqual([])
    expect(engine.activity.list().filter((event) => event.kind === 'memory_captured')).toEqual([])
  })
})

describe('a provider switch writes a Handoff', () => {
  const LIMIT = "\u001b[31mYou've hit your limit\u001b[0m · resets 3pm (UTC)"

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-17T12:00:00.000Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Vega on Claude, with the Company set to continue on Codex when Claude runs out. */
  function routed() {
    const claude = fakeProvider({ accounts: true })
    const codex = fakeProvider({ accounts: true })
    const { engine, pages } = setup({
      providers: { claude, codex },
      accountsDir: onDisk('/app/accounts'),
      makeAccountDir: () => {},
    })
    claude.connect(engine.sessions.receiveHook)
    codex.connect(engine.sessions.receiveHook)
    engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
    const vega = engine.employees.create({ name: 'Vega', roleId: 'backend' })
    engine.sessions.start(vega.id)
    claude.spawnOf(vega.id).hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)
    engine.usageRouting.setRule('claude', { kind: 'continue', provider: 'codex', model: 'gpt-6-sol' })
    return { engine, pages, claude, codex, vega }
  }

  it('is written open, names the ticket, and is claimed exactly once by the Session that gets it', () => {
    const { engine, claude, codex, vega } = routed()
    const ticket = engine.board().createTicket({ title: 'Usage chart' })
    engine.board().updateTicket(ticket.id, { assigneeId: vega.id })
    engine.board().moveTicket(ticket.id, 'doing')

    claude.spawnOf(vega.id).pty.output(LIMIT)

    const handoff = engine.companyMemory.list({ kind: 'handoff' })
    expect(handoff).toHaveLength(1)
    expect(handoff[0]).toMatchObject({ title: 'Vega → Codex · AC-1', handoff: { state: 'open', claimedBy: null } })
    expect(engine.companyMemory.get(handoff[0]!.slug)?.body).toContain('On AC-1 — Usage chart')

    // The new Session reaching idle is what claims it, and the prompt it gets names the page.
    codex.spawnOf(vega.id).hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)
    expect(engine.companyMemory.get(handoff[0]!.slug)?.handoff).toMatchObject({
      state: 'claimed',
      claimedBy: 'Vega',
    })
    const prompt = codex.spawnOf(vega.id).pushed.find((text) => text.includes('## Ticket')) ?? ''
    expect(prompt).toContain(`\`${handoff[0]!.slug}\`, claimed for you`)

    // A second turn boundary must not claim it again, and must not throw.
    codex.spawnOf(vega.id).hook('Stop')
    vi.advanceTimersByTime(READY_DELAY_MS)
    expect(engine.companyMemory.get(handoff[0]!.slug)?.handoff?.claimedBy).toBe('Vega')
  })

  it('closes with the ticket', () => {
    const { engine, claude, codex, vega } = routed()
    const ticket = engine.board().createTicket({ title: 'Usage chart' })
    engine.board().updateTicket(ticket.id, { assigneeId: vega.id })
    engine.board().moveTicket(ticket.id, 'doing')
    claude.spawnOf(vega.id).pty.output(LIMIT)
    codex.spawnOf(vega.id).hook('SessionStart')
    vi.advanceTimersByTime(READY_DELAY_MS)

    engine.board().moveTicket(ticket.id, 'done')

    const [page] = engine.companyMemory.list({ kind: 'handoff' })
    expect(page?.handoff?.state).toBe('done')
  })
})
