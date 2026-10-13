import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS, COMPANY_AUTHOR, dmChannelId } from '../../../shared/domain/chat'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import { inMemoryNotesFiles, inMemoryRecents } from '../../core/testing'
import { type FakeProvider, fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from './sessions'

const engines: CompanyEngine[] = []
const folders: string[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  vi.useRealTimers()
})

/** One run of the app: an engine over a real Company folder, so closing it is a real quit. */
function launch(notesFiles = inMemoryNotesFiles()): { engine: CompanyEngine; provider: FakeProvider } {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    recents: inMemoryRecents(),
    providers: { claude: provider },
    notesFiles,
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

function quit(engine: CompanyEngine): void {
  engines.splice(engines.indexOf(engine), 1)
  engine.close()
}

/** A Company whose Employees each ran a Session that got ready, then the app quit. */
function companyThatRan(names: string[]) {
  const folder = mkdtempSync(join(tmpdir(), 'tinycorp-restore-'))
  folders.push(folder)
  const notesFiles = inMemoryNotesFiles()
  const { engine, provider } = launch(notesFiles)
  engine.createCompany({ folder, name: 'Acme' })
  const team = names.map((name) => engine.employees.create({ name, roleId: 'backend' }))
  const sessionIds = new Map<string, string>()
  for (const employee of team) {
    const { providerSessionId } = engine.sessions.start(employee.id)
    provider.spawnOf(employee.id).hook('SessionStart', { source: 'startup' })
    sessionIds.set(employee.id, providerSessionId!)
  }
  vi.advanceTimersByTime(READY_DELAY_MS)
  return { folder, notesFiles, first: engine, firstProvider: provider, team, sessionIds }
}

/** Quits the first run and opens the Company in a second one. */
function reopen({ folder, notesFiles, first }: ReturnType<typeof companyThatRan>) {
  quit(first)
  const second = launch(notesFiles)
  second.engine.openCompany(folder)
  return second
}

const statusOf = (engine: CompanyEngine, employeeId: string) => engine.sessions.get(employeeId).status

/** A real Company folder, memory git and all, opened twice: on a Windows runner that is over a minute. */
const SLOW_DISK = process.platform === 'win32' ? { timeout: 240_000 } : {}

describe('Resume on open', SLOW_DISK, () => {
  it('restarts every Session that was running with --resume <stored id>', () => {
    const ran = companyThatRan(['Ada', 'Grace'])
    const [ada, grace] = ran.team

    const { engine, provider } = reopen(ran)

    expect(
      provider.spawns.map(({ request }) => ({
        id: request.employee.id,
        sessionId: request.sessionId,
        resume: request.resume,
      })),
    ).toEqual([
      { id: ada!.id, sessionId: ran.sessionIds.get(ada!.id), resume: true },
      { id: grace!.id, sessionId: ran.sessionIds.get(grace!.id), resume: true },
    ])
    expect(statusOf(engine, ada!.id)).toBe('starting')
    expect(engine.sessions.get(ada!.id).providerSessionId).toBe(ran.sessionIds.get(ada!.id))
  })

  it('is confirmed by SessionStart(source=resume): the Session goes idle and is not primed', () => {
    const ran = companyThatRan(['Ada'])
    const [ada] = ran.team
    const { engine, provider } = reopen(ran)

    provider.spawnOf(ada!.id).hook('SessionStart', { source: 'resume' })
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(statusOf(engine, ada!.id)).toBe('idle')
    expect(provider.spawns).toHaveLength(1)
    expect(provider.spawnOf(ada!.id).pushed).toEqual([])
  })

  it('writes fresh instructions, with the memory file, before resuming', () => {
    const ran = companyThatRan(['Ada'])
    const [ada] = ran.team
    ran.notesFiles.write(join(ran.folder, 'memory', `${ada!.id}.md`), 'I own the api\n')

    const { provider } = reopen(ran)

    expect(provider.spawnOf(ada!.id).instructions!.text).toContain('I own the api')
  })

  it('does not bring back a Session the boss stopped', () => {
    const ran = companyThatRan(['Ada', 'Grace'])
    const [ada, grace] = ran.team
    ran.first.sessions.stop(ada!.id)

    const { engine, provider } = reopen(ran)

    expect(provider.spawns.map((s) => s.request.employee.id)).toEqual([grace!.id])
    expect(statusOf(engine, ada!.id)).toBe('off')
  })

  it('does not start Employees that never had a Session', () => {
    const ran = companyThatRan([])
    ran.first.employees.create({ name: 'Ada', roleId: 'backend' })

    const { provider } = reopen(ran)

    expect(provider.spawns).toEqual([])
  })

  it('respects the concurrency cap: the rest come back parked and resume when a slot frees', () => {
    const ran = companyThatRan(['Ada', 'Grace'])
    const [ada, grace] = ran.team
    ran.first.capacity.setConcurrencyCap(1)

    const { engine, provider } = reopen(ran)
    const parked = statusOf(engine, grace!.id)
    provider.spawnOf(ada!.id).hook('SessionStart', { source: 'resume' })
    provider.spawnOf(ada!.id).pty.exit(0)

    expect(parked).toBe('parked')
    expect(provider.spawnOf(grace!.id).request).toMatchObject({
      sessionId: ran.sessionIds.get(grace!.id),
      resume: true,
    })
  })

  it('starts fresh, unprimed, when the boss stops and starts a restored Session', () => {
    const ran = companyThatRan(['Ada'])
    const [ada] = ran.team
    const { engine, provider } = reopen(ran)

    engine.sessions.stop(ada!.id)
    engine.sessions.start(ada!.id)
    provider.spawnOf(ada!.id).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(provider.spawnOf(ada!.id).request.resume).toBe(false)
    expect(provider.spawnOf(ada!.id).pushed).toEqual([])
  })

  it('does nothing when a Company that is already open is opened again', () => {
    const ran = companyThatRan(['Ada'])
    const spawned = ran.firstProvider.spawns.length

    ran.first.openCompany(ran.folder)

    expect(ran.firstProvider.spawns).toHaveLength(spawned)
  })
})

describe('Primed fallback', () => {
  /** A reopened Company where Ada holds a ticket and has talked in chat. */
  function reopenedWithWork() {
    const ran = companyThatRan(['Ada'])
    const [ada] = ran.team
    const board = ran.first.board()
    const ticket = board.createTicket({ title: 'Login page', assigneeId: ada!.id })
    board.moveTicket(ticket.id, 'doing')
    board.createTicket({ title: 'Somebody else’s work' })
    const chat = ran.first.chat()
    chat.post({ authorId: BOSS, channelId: dmChannelId(BOSS, ada!.id), text: 'Use magic links, not passwords' })
    chat.post({ authorId: ada!.id, channelId: 'tech', text: 'Starting on the login form' })
    chat.post({ authorId: COMPANY_AUTHOR, channelId: 'general', text: 'Unrelated chatter' })
    const reopened = reopen(ran)
    return { ...reopened, ran, ada: ada!, ticket }
  }

  it('starts a fresh Session when the resumed one exits before SessionStart', () => {
    const { engine, provider, ran, ada } = reopenedWithWork()

    provider.spawnOf(ada.id).pty.exit(1)

    const fresh = provider.spawnOf(ada.id)
    expect(provider.spawns).toHaveLength(2)
    expect(fresh.request.resume).toBe(false)
    expect(fresh.request.sessionId).not.toBe(ran.sessionIds.get(ada.id))
    expect(statusOf(engine, ada.id)).toBe('starting')
    expect(engine.sessions.get(ada.id).providerSessionId).toBe(fresh.request.sessionId)
  })

  it('primes the fresh Session, once idle, with its ticket, recent chat and a git status instruction', () => {
    const { provider, ada } = reopenedWithWork()
    provider.spawnOf(ada.id).pty.exit(1)
    const fresh = provider.spawnOf(ada.id)

    fresh.hook('SessionStart', { source: 'startup' })
    const beforeReady = [...fresh.pushed]
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(beforeReady).toEqual([])
    const primer = fresh.pushed[0]!
    expect(primer).toMatch(/^\[company\]/)
    expect(primer).toContain('git status')
    expect(primer).toMatch(/AC-\d+ "Login page" \(Doing\)/)
    expect(primer).not.toContain('Somebody else’s work')
    expect(primer).toContain('Use magic links, not passwords')
    expect(primer).toContain('Starting on the login form')
    expect(primer).not.toContain('Unrelated chatter')
    expect(primer).not.toContain('\n')
  })

  it('includes every #general message folded into one inbox item', () => {
    const ran = companyThatRan(['Ada', 'Grace'])
    const [ada, grace] = ran.team
    const chat = ran.first.chat()
    for (const text of ['one', 'two', 'three']) chat.post({ authorId: grace!.id, channelId: 'general', text })
    const { provider } = reopen(ran)
    provider.spawnOf(ada!.id).pty.exit(1)
    const fresh = provider.spawnOf(ada!.id)

    fresh.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)

    for (const text of ['one', 'two', 'three']) expect(fresh.pushed[0]).toContain(`Grace: "${text}"`)
  })

  it('pushes the primer before anything already waiting in the inbox', () => {
    const { engine, provider, ada } = reopenedWithWork()
    const waiting = engine.inbox.list(ada.id).filter((item) => item.status === 'pending')
    provider.spawnOf(ada.id).pty.exit(1)
    const fresh = provider.spawnOf(ada.id)

    fresh.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(waiting.length).toBeGreaterThan(0)
    expect(fresh.pushed).toHaveLength(1)
    expect(fresh.pushed[0]).toContain('git status')
    const items = engine.inbox.list(ada.id)
    expect(items.find((item) => item.kind === 'resume')).toMatchObject({ prompt: fresh.pushed[0] })
  })

  it('primes a Session whose SessionStart says it started fresh instead of resuming', () => {
    const { provider, ada } = reopenedWithWork()
    const spawn = provider.spawnOf(ada.id)

    spawn.hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(provider.spawns).toHaveLength(1)
    expect(spawn.pushed[0]).toContain('git status')
    expect(spawn.pushed[0]).toContain('Login page')
  })

  it('says so when the Employee holds no open ticket', () => {
    const ran = companyThatRan(['Ada'])
    const [ada] = ran.team
    ran.first.chat().post({ authorId: BOSS, channelId: dmChannelId(BOSS, ada!.id), text: 'Look at the flaky test' })
    const { provider } = reopen(ran)

    provider.spawnOf(ada!.id).pty.exit(1)
    provider.spawnOf(ada!.id).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(provider.spawnOf(ada!.id).pushed[0]).toMatch(/no open ticket/i)
  })

  it('pushes no primer when there is nothing to catch up on: no ticket and no chat', () => {
    const ran = companyThatRan(['Ada'])
    const [ada] = ran.team
    const { provider } = reopen(ran)

    provider.spawnOf(ada!.id).pty.exit(1)
    provider.spawnOf(ada!.id).hook('SessionStart', { source: 'startup' })
    vi.advanceTimersByTime(READY_DELAY_MS)

    expect(provider.spawnOf(ada!.id).pushed).toEqual([])
  })

  /**
   * T199, finding H5: the resumed Session is never coming back and the fresh one below is spawned
   * under an id of its own, so what the adapter wrote for the failed conversation would sit in the
   * app's folder — with its bearer token — for the life of the install.
   */
  it('forgets the resume that failed, as well as the Session it replaces it with', () => {
    const { engine, provider, ada } = reopenedWithWork()
    const failed = provider.spawnOf(ada.id).request.sessionId

    provider.spawnOf(ada.id).pty.exit(1)
    const fresh = provider.spawnOf(ada.id).request.sessionId
    engine.sessions.stop(ada.id)

    expect(fresh).not.toBe(failed)
    expect(provider.forgotten).toEqual([failed, fresh])
  })

  it('does not respawn again when the fresh Session exits too', () => {
    const { engine, provider, ada } = reopenedWithWork()
    provider.spawnOf(ada.id).pty.exit(1)

    provider.spawnOf(ada.id).pty.exit(1)

    expect(provider.spawns).toHaveLength(2)
    expect(statusOf(engine, ada.id)).toBe('off')
  })
})
