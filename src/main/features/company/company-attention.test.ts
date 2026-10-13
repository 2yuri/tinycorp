import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BOSS, dmChannelId } from '../../../shared/domain/chat'
import { bossInboxUnread } from '../../../shared/inbox/boss-inbox'
import { type OpenDatabase, openDatabaseFile } from '../../core/database'
import { type CompanyEngine, createCompanyEngine } from '../../core/engine/company-engine'
import type { RecentCompanies } from '../../core/recents'
import { inMemoryDatabases, inMemoryRecents, onDisk } from '../../core/testing'
import { fakeGit } from '../../platform/testing'
import { fakeProvider } from '../../providers/testing'
import { READY_DELAY_MS } from '../sessions/sessions'

const engines: CompanyEngine[] = []
const dirs: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function engineWith(options: { openDatabase?: OpenDatabase; recents?: RecentCompanies } = {}) {
  const provider = fakeProvider()
  const engine = createCompanyEngine({
    openDatabase: options.openDatabase ?? inMemoryDatabases(),
    recents: options.recents ?? inMemoryRecents(),
    providers: { claude: provider },
    isGitRepo: () => true,
    git: fakeGit(),
    mcpUrl: () => 'http://127.0.0.1/mcp',
    log: () => {},
  })
  provider.connect(engine.sessions.receiveHook)
  engines.push(engine)
  return { engine, provider }
}

/** Two open Companies, each with an Employee; Globex is current, Acme carries on behind it. */
function twoCompanies() {
  vi.useFakeTimers()
  const { engine, provider } = engineWith()
  const acme = engine.createCompany({ folder: onDisk('/work/acme'), name: 'Acme' })
  const ada = engine.employees.create({ name: 'Ada', roleId: 'backend' })
  engine.sessions.start(ada.id)
  const session = provider.spawnOf(ada.id)
  session.hook('SessionStart', { source: 'startup' })
  vi.advanceTimersByTime(READY_DELAY_MS)
  // What Ada can do in Acme while the boss looks at Globex: the MCP tools her Session holds.
  const caller = engine.mcpCaller(acme.id, session.mcp!.token)!
  const globex = engine.createCompany({ folder: onDisk('/work/globex'), name: 'Globex' })
  const grace = engine.employees.create({ name: 'Grace', roleId: 'backend' })
  return { engine, acme, ada, session, caller, globex, grace }
}

const entryOf = (engine: CompanyEngine, companyId: string) =>
  engine.companyAttention().find((entry) => entry.companyId === companyId)

describe('the Company rail’s marks (T145)', () => {
  it('counts what the Inbox counts, for the Company in view and the one behind it', () => {
    const { engine, acme, ada, caller, globex, grace } = twoCompanies()
    caller.chat.post({ authorId: ada.id, channelId: 'tech', text: '@boss can you confirm the tiers?' })
    caller.chat.post({ authorId: ada.id, channelId: dmChannelId(ada.id, BOSS), text: 'a word?' })
    caller.chat.post({ authorId: ada.id, channelId: 'tech', text: 'migrations are green' })
    engine.chat().post({ authorId: grace.id, channelId: 'general', text: '@boss the deploy is out' })

    expect(entryOf(engine, globex.id)).toEqual({ companyId: globex.id, waiting: 1, working: false })
    expect(entryOf(engine, globex.id)!.waiting).toBe(bossInboxUnread(engine.chat().bossInbox()))
    expect(entryOf(engine, acme.id)!.waiting).toBe(2)
    engine.switchCompany(acme.id)
    expect(entryOf(engine, acme.id)!.waiting).toBe(bossInboxUnread(engine.chat().bossInbox()))
  })

  it('shows nothing waiting for a Company that has nothing for the boss', () => {
    const { engine, acme, globex, grace } = twoCompanies()
    engine.chat().post({ authorId: grace.id, channelId: 'tech', text: 'migrations are green' })
    engine.chat().post({ authorId: BOSS, channelId: 'tech', text: '@boss note to self' })

    expect(engine.companyAttention()).toEqual([
      { companyId: acme.id, waiting: 0, working: false },
      { companyId: globex.id, waiting: 0, working: false },
    ])
  })

  it('follows a decision asked for in a Company the boss is not looking at, and the boss reading it', () => {
    const { engine, acme, ada, caller } = twoCompanies()
    const heard = vi.fn()
    engine.onAttentionChange(heard)
    expect(entryOf(engine, acme.id)!.waiting).toBe(0)

    const outcome = caller.approvals.request({ requesterId: ada.id, action: 'hire', subject: 'A designer' })
    if (outcome.gate !== 'ask') throw new Error('a hire asks under Managed')

    expect(heard).toHaveBeenCalled()
    expect(entryOf(engine, acme.id)!.waiting).toBe(1)

    // The boss goes over, decides and opens the thread: the Inbox and the badge both let it go.
    engine.switchCompany(acme.id)
    engine.approvals.decide(outcome.approval.id, { approve: true })
    expect(entryOf(engine, acme.id)!.waiting).toBe(bossInboxUnread(engine.chat().bossInbox()))
    heard.mockClear()
    engine.chat().markReadByBoss(outcome.approval.channelId)
    expect(heard).toHaveBeenCalled()
    expect(entryOf(engine, acme.id)!.waiting).toBe(0)
  })

  it('reads a Company’s Inbox once until something in it moves, never on a Session tick', () => {
    const { engine, acme, ada, session, caller } = twoCompanies()
    engine.companyAttention()
    const chat = caller.chat
    const read = vi.spyOn(chat, 'bossInbox')

    session.hook('UserPromptSubmit', { prompt: 'go' })
    session.hook('PreToolUse', { tool_name: 'Edit' })
    session.hook('PostToolUse', { tool_name: 'Edit' })
    engine.companyAttention()
    engine.companyAttention()
    expect(read).not.toHaveBeenCalled()

    chat.post({ authorId: ada.id, channelId: 'tech', text: '@boss done' })
    expect(entryOf(engine, acme.id)!.waiting).toBe(1)
    engine.companyAttention()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('marks a Company working while one of its Sessions is busy, and only then', () => {
    const { engine, acme, globex, session } = twoCompanies()
    const heard = vi.fn()
    engine.onAttentionChange(heard)

    session.hook('UserPromptSubmit', { prompt: 'go' })
    expect(entryOf(engine, acme.id)!.working).toBe(true)
    expect(entryOf(engine, globex.id)!.working).toBe(false)
    expect(heard).toHaveBeenCalledTimes(1)

    // A tool call inside the same turn changes nothing the rail draws.
    session.hook('PreToolUse', { tool_name: 'Edit' })
    expect(heard).toHaveBeenCalledTimes(1)

    session.hook('Stop')
    expect(entryOf(engine, acme.id)!.working).toBe(false)
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('counts a Session stopped in its terminal asking the boss (T165), in the Company behind the one in view', () => {
    const { engine, acme, globex, session } = twoCompanies()
    const before = entryOf(engine, acme.id)!.waiting
    const heard = vi.fn()
    engine.onAttentionChange(heard)

    session.hook('UserPromptSubmit', { prompt: 'go' })
    session.hook('PermissionRequest', {
      cwd: onDisk('/work/acme'),
      tool_name: 'Write',
      tool_input: { file_path: onDisk('/work/acme/a.ts') },
    })
    expect(entryOf(engine, acme.id)!.waiting).toBe(before + 1)
    expect(entryOf(engine, globex.id)!.waiting).toBe(0)
    const calls = heard.mock.calls.length

    session.hook('PostToolUse', { tool_name: 'Write' })
    expect(entryOf(engine, acme.id)!.waiting).toBe(before)
    expect(heard.mock.calls.length).toBeGreaterThan(calls)
  })

  it('says nothing about a Company that is not open, and never opens its folder to ask', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tinycorp-attention-'))
    dirs.push(dir)
    for (const name of ['acme', 'globex']) mkdirSync(join(dir, name))
    const recents = inMemoryRecents()
    const before = engineWith({ recents, openDatabase: openDatabaseFile }).engine
    const acme = before.createCompany({ folder: join(dir, 'acme'), name: 'Acme' })
    const ada = before.employees.create({ name: 'Ada', roleId: 'backend' })
    before.chat().post({ authorId: ada.id, channelId: 'tech', text: '@boss one for you' })
    before.close()

    const opened: string[] = []
    const { engine } = engineWith({
      recents,
      openDatabase: (folder, mode) => {
        opened.push(folder)
        return openDatabaseFile(folder, mode)
      },
    })
    const globex = engine.createCompany({ folder: join(dir, 'globex'), name: 'Globex' })
    opened.length = 0

    expect(engine.listCompanies().map((c) => c.id)).toContain(acme.id)
    expect(engine.companyAttention()).toEqual([{ companyId: globex.id, waiting: 0, working: false }])
    expect(opened).toEqual([])
  })
})
